import { DurableObject } from "cloudflare:workers";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { richTextSnapshot } from "./rich-text";
import { createHibernationAwareness, expireStaleAwareness } from "./collaboration-awareness";

type RoomIdentity = { organizationId: string; courseId: string; lessonId: string };
type SocketIdentity = RoomIdentity & { userId: string; username: string; tokenHash: string; awarenessClientId?: number; rateWindow?: number; rateCount?: number };
type RoomMetadata = RoomIdentity & { initialized: number };
const maxMessageBytes = 256 * 1024;
const maxSockets = 20;
const maxMessagesPerWindow = 600;
const rateWindowMs = 60_000;

function denied(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function awarenessClients(update: Uint8Array): { clients: { id: number; clock: number; state: unknown }[] } {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  if (count !== 1) throw new Error("An editor may publish only its own presence");
  const clients: { id: number; clock: number; state: unknown }[] = [];
  for (let index = 0; index < count; index++) {
    const id = decoding.readVarUint(decoder), clock = decoding.readVarUint(decoder), raw = decoding.readVarString(decoder);
    if (raw.length > 2_048) throw new Error("Presence is too large");
    clients.push({ id, clock, state: JSON.parse(raw) as unknown });
  }
  if (decoding.hasContent(decoder)) throw new Error("Trailing awareness bytes");
  return { clients };
}

function trustedAwareness(update: Uint8Array, identity: SocketIdentity): { bytes: Uint8Array; clientId: number } {
  const decoded = awarenessClients(update), record = decoded.clients[0];
  if (identity.awarenessClientId !== undefined && identity.awarenessClientId !== record.id) throw new Error("Presence client identity changed");
  if (record.state !== null && (!record.state || typeof record.state !== "object" || Array.isArray(record.state))) throw new Error("Presence state is invalid");
  const state = record.state === null ? null : { user: { name: identity.username.slice(0, 80), color: colorFor(identity.username) } };
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarUint(encoder, record.id);
  encoding.writeVarUint(encoder, record.clock);
  encoding.writeVarString(encoder, JSON.stringify(state));
  return { bytes: encoding.toUint8Array(encoder), clientId: record.id };
}

function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const palette = ["#14594D", "#8B3E24", "#4D5593", "#426929", "#8C4D74", "#27667A"];
  return palette[Math.abs(hash) % palette.length];
}

export class LessonCollaborationRoom extends DurableObject<Env> {
  private readonly doc = new Y.Doc();
  private readonly awareness = createHibernationAwareness(this.doc);
  private metadata: RoomMetadata | null = null;
  private hydrated: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.hydrated = ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS room_metadata (
        id INTEGER PRIMARY KEY CHECK(id=1), organization_id TEXT NOT NULL, course_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL, initialized INTEGER NOT NULL DEFAULT 0
      )`);
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS room_snapshots (id INTEGER PRIMARY KEY CHECK(id=1), payload BLOB NOT NULL)");
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS room_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, payload BLOB NOT NULL)");
      this.metadata = this.ctx.storage.sql.exec<RoomMetadata>("SELECT organization_id AS organizationId,course_id AS courseId,lesson_id AS lessonId,initialized FROM room_metadata WHERE id=1").toArray()[0] || null;
      const snapshot = this.ctx.storage.sql.exec<{ payload: ArrayBuffer }>("SELECT payload FROM room_snapshots WHERE id=1").toArray()[0];
      if (snapshot) Y.applyUpdate(this.doc, new Uint8Array(snapshot.payload), "storage");
      for (const update of this.ctx.storage.sql.exec<{ payload: ArrayBuffer }>("SELECT payload FROM room_updates ORDER BY id").toArray()) Y.applyUpdate(this.doc, new Uint8Array(update.payload), "storage");
      this.doc.on("update", (update, origin) => this.persistAndBroadcast(update, origin));
      this.awareness.setLocalState(null);
      this.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const ids = [...added, ...updated, ...removed];
        if (!ids.length) return;
        const message = encoding.createEncoder();
        encoding.writeVarUint(message, 1);
        encoding.writeVarUint8Array(message, awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids));
        this.broadcast(encoding.toUint8Array(message), origin instanceof WebSocket ? origin : undefined);
      });
    });
  }

  async initialize(identity: RoomIdentity, seed: Uint8Array): Promise<void> {
    await this.hydrated;
    if (!/^[a-z0-9-]{1,80}$/.test(identity.organizationId) || !/^[a-z0-9-]{1,100}$/.test(identity.courseId) || !/^[a-z0-9-]{1,100}$/.test(identity.lessonId) || seed.byteLength > 512 * 1024) throw new Error("Invalid collaboration room");
    if (this.metadata) {
      if (this.metadata.organizationId !== identity.organizationId || this.metadata.courseId !== identity.courseId || this.metadata.lessonId !== identity.lessonId) throw new Error("Collaboration identity mismatch");
      return;
    }
    this.metadata = { ...identity, initialized: 1 };
    this.ctx.storage.sql.exec("INSERT INTO room_metadata(id,organization_id,course_id,lesson_id,initialized) VALUES (1,?,?,?,0)", identity.organizationId, identity.courseId, identity.lessonId);
    this.doc.transact(() => Y.applyUpdate(this.doc, seed, "seed"), "seed");
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO room_snapshots(id,payload) VALUES (1,?)", Uint8Array.from(Y.encodeStateAsUpdate(this.doc)).buffer as ArrayBuffer);
    this.ctx.storage.sql.exec("DELETE FROM room_updates");
    this.ctx.storage.sql.exec("UPDATE room_metadata SET initialized=1 WHERE id=1");
    this.metadata.initialized = 1;
  }

  async snapshot(identity: RoomIdentity, activityIds: string[]): Promise<Record<string, unknown>> {
    await this.hydrated;
    if (!this.metadata) return {};
    if (!this.matches(identity) || !Array.isArray(activityIds) || activityIds.length > 30) throw new Error("Collaboration document unavailable");
    return richTextSnapshot(this.doc, activityIds);
  }

  async fetch(request: Request): Promise<Response> {
    await this.hydrated;
    const identity = this.identityFrom(request.headers);
    if (!identity || !this.matches(identity) || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return denied(404, "Documento colaborativo no disponible.");
    const socketIdentity: SocketIdentity = {
      ...identity,
      userId: request.headers.get("X-HL-User") || "",
      username: request.headers.get("X-HL-Username") || "Educador",
      tokenHash: request.headers.get("X-HL-Session") || "",
      rateWindow: Date.now(),
      rateCount: 0,
    };
    if (!socketIdentity.userId || !/^[a-f0-9]{64}$/.test(socketIdentity.tokenHash)) return denied(401, "Inicia sesión para editar.");
    if (!await this.authorized(socketIdentity)) return denied(403, "Tu sesión o permisos ya no permiten editar este curso.");
    if (this.ctx.getWebSockets().length >= maxSockets) return denied(429, "El documento alcanzó el límite de 20 editores simultáneos.");
    expireStaleAwareness(this.awareness);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(socketIdentity);
    const sync = encoding.createEncoder();
    encoding.writeVarUint(sync, 0);
    syncProtocol.writeSyncStep1(sync, this.doc);
    server.send(encoding.toUint8Array(sync));
    const state = encoding.createEncoder();
    encoding.writeVarUint(state, 1);
    encoding.writeVarUint8Array(state, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]));
    server.send(encoding.toUint8Array(state));
    return new Response(null, { status: 101, webSocket: client, headers: { "Cache-Control": "no-store" } });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const identity = socket.deserializeAttachment() as SocketIdentity | null;
    if (!identity || !await this.authorized(identity)) { socket.close(1008, "Permiso revocado"); return; }
    expireStaleAwareness(this.awareness);
    const now = Date.now();
    if (!identity.rateWindow || now - identity.rateWindow >= rateWindowMs) { identity.rateWindow = now; identity.rateCount = 0; }
    identity.rateCount = (identity.rateCount || 0) + 1;
    socket.serializeAttachment(identity);
    if (identity.rateCount > maxMessagesPerWindow) { socket.close(1008, "Límite de mensajes excedido"); return; }
    if (typeof message === "string" || message.byteLength > maxMessageBytes) { socket.close(1009, "Mensaje demasiado grande o inválido"); return; }
    const decoder = decoding.createDecoder(new Uint8Array(message));
    const response = encoding.createEncoder();
    try {
      const type = decoding.readVarUint(decoder);
      if (type === 0) {
        encoding.writeVarUint(response, 0);
        syncProtocol.readSyncMessage(decoder, response, this.doc, socket, error => console.warn("Collaboration protocol rejected update", error.message));
        if (encoding.length(response) > 1) socket.send(encoding.toUint8Array(response));
      } else if (type === 1) {
        const update = decoding.readVarUint8Array(decoder);
        const decoded = trustedAwareness(update, identity);
        const claimedByOther = this.ctx.getWebSockets().some(peer => {
          if (peer === socket) return false;
          const peerIdentity = peer.deserializeAttachment() as SocketIdentity | null;
          return peerIdentity?.awarenessClientId === decoded.clientId;
        });
        if (claimedByOther) { socket.close(1008, "La presencia ya pertenece a otra sesión."); return; }
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoded.bytes, socket);
        identity.awarenessClientId = decoded.clientId;
        socket.serializeAttachment(identity);
      } else socket.close(1008, "Protocolo no admitido");
    } catch (error) {
      console.warn("Collaboration message rejected", error instanceof Error ? error.message : "invalid message");
      socket.close(1008, "Mensaje de colaboración inválido");
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> { this.clearAwareness(socket); }
  async webSocketError(socket: WebSocket): Promise<void> { this.clearAwareness(socket); }

  private matches(identity: RoomIdentity): boolean {
    return !!this.metadata && this.metadata.initialized === 1 && this.metadata.organizationId === identity.organizationId && this.metadata.courseId === identity.courseId && this.metadata.lessonId === identity.lessonId;
  }

  private identityFrom(headers: Headers): RoomIdentity | null {
    const identity = { organizationId: headers.get("X-HL-Organization") || "", courseId: headers.get("X-HL-Course") || "", lessonId: headers.get("X-HL-Lesson") || "" };
    return Object.values(identity).every(Boolean) ? identity : null;
  }

  private async authorized(identity: SocketIdentity): Promise<boolean> {
    if (!this.env.ORGANIZATIONS) return false;
    return this.env.ORGANIZATIONS.getByName(identity.organizationId).authorizeCollaborator(identity.organizationId, identity.courseId, identity.lessonId, identity.userId, identity.tokenHash);
  }

  private persistAndBroadcast(update: Uint8Array, origin: unknown): void {
    if (origin !== "seed") {
      this.ctx.storage.sql.exec("INSERT INTO room_updates(payload) VALUES (?)", Uint8Array.from(update).buffer as ArrayBuffer);
      const count = this.ctx.storage.sql.exec<{ count: number }>("SELECT count(*) AS count FROM room_updates").one().count;
      if (count >= 200) {
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO room_snapshots(id,payload) VALUES (1,?)", Uint8Array.from(Y.encodeStateAsUpdate(this.doc)).buffer as ArrayBuffer);
        this.ctx.storage.sql.exec("DELETE FROM room_updates");
      }
    }
    const message = encoding.createEncoder();
    encoding.writeVarUint(message, 0);
    syncProtocol.writeUpdate(message, update);
    this.broadcast(encoding.toUint8Array(message), origin instanceof WebSocket ? origin : undefined);
  }

  private broadcast(message: Uint8Array, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try { socket.send(message); } catch { socket.close(1011, "No se pudo sincronizar"); }
    }
  }

  private clearAwareness(socket: WebSocket): void {
    const identity = socket.deserializeAttachment() as SocketIdentity | null;
    if (identity?.awarenessClientId !== undefined) awarenessProtocol.removeAwarenessStates(this.awareness, [identity.awarenessClientId], socket);
  }
}
