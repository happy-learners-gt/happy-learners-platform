import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

export type CollaborationStatus = "connecting" | "live" | "reconnecting" | "failed" | "closed";

export class CollaborationProvider {
  readonly awareness: awarenessProtocol.Awareness;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | undefined;
  private retry = 0;
  private destroyed = false;
  private synced = false;
  private readonly updateHandler: (update: Uint8Array, origin: unknown) => void;
  private readonly awarenessHandler: (change: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void;
  private status: CollaborationStatus = "connecting";
  private readonly listeners = new Set<(status: CollaborationStatus) => void>();

  constructor(readonly doc: Y.Doc, courseId: string, lessonId: string, username: string) {
    this.awareness = new awarenessProtocol.Awareness(doc);
    const color = colorFor(username);
    this.awareness.setLocalStateField("user", { name: username, color });
    this.updateHandler = (update, origin) => { if (origin !== this.socket) this.sendSyncUpdate(update); };
    this.awarenessHandler = ({ added, updated, removed }, origin) => {
      if (origin === this.socket || this.destroyed) return;
      const ids = [...added, ...updated, ...removed];
      if (!ids.length) return;
      const payload = encoding.createEncoder();
      encoding.writeVarUint(payload, 1);
      encoding.writeVarUint8Array(payload, awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids));
      this.send(payload);
    };
    doc.on("update", this.updateHandler);
    this.awareness.on("update", this.awarenessHandler);
    const path = `/api/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/collaborate`;
    this.connect(path);
  }

  getStatus(): CollaborationStatus { return this.status; }
  subscribe(listener: (status: CollaborationStatus) => void): () => void { this.listeners.add(listener); listener(this.status); return () => this.listeners.delete(listener); }
  subscribePresence(listener: () => void): () => void { this.awareness.on("update", listener); return () => this.awareness.off("update", listener); }
  getEditors(): string[] { return [...new Set([...this.awareness.getStates().values()].flatMap(state => typeof state.user?.name === "string" ? [state.user.name] : []))]; }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
    this.doc.off("update", this.updateHandler);
    this.awareness.off("update", this.awarenessHandler);
    this.awareness.setLocalState(null);
    this.socket?.close(1000, "Editor cerrado");
    this.awareness.destroy();
    this.doc.destroy();
    this.setStatus("closed");
  }

  private connect(path: string): void {
    if (this.destroyed) return;
    this.setStatus(this.retry ? "reconnecting" : "connecting");
    const endpoint = new URL(path, window.location.href);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(endpoint);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 0;
      const sync = encoding.createEncoder();
      encoding.writeVarUint(sync, 0);
      syncProtocol.writeSyncStep1(sync, this.doc);
      socket.send(encoding.toUint8Array(sync));
      this.sendAwareness([...this.awareness.getStates().keys()]);
    };
    socket.onmessage = event => {
      if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > 256 * 1024) { socket.close(1009, "Respuesta inválida"); return; }
      const decoder = decoding.createDecoder(new Uint8Array(event.data));
      try {
        const type = decoding.readVarUint(decoder);
        if (type === 0) {
          const answer = encoding.createEncoder();
          const syncType = syncProtocol.readSyncMessage(decoder, answer, this.doc, socket);
          if (encoding.length(answer)) {
            const response = encoding.createEncoder();
            encoding.writeVarUint(response, 0);
            encoding.writeBinaryEncoder(response, answer);
            socket.send(encoding.toUint8Array(response));
          }
          if (syncType === syncProtocol.messageYjsSyncStep2 && !this.synced) { this.synced = true; this.setStatus("live"); }
        } else if (type === 1) {
          awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), socket);
        } else socket.close(1008, "Protocolo no admitido");
      } catch { socket.close(1008, "Respuesta colaborativa inválida"); }
    };
    socket.onerror = () => { if (!this.destroyed) this.setStatus("reconnecting"); };
    socket.onclose = event => {
      if (this.socket === socket) this.socket = null;
      this.synced = false;
      if (this.destroyed) return;
      if (event.code === 1008 || event.code === 1009) { this.setStatus("failed"); return; }
      this.retry++;
      const delay = Math.min(15_000, 400 * 2 ** Math.min(this.retry, 5)) + Math.floor(Math.random() * 250);
      this.reconnectTimer = window.setTimeout(() => this.connect(path), delay);
      this.setStatus("reconnecting");
    };
  }

  private sendSyncUpdate(update: Uint8Array): void {
    const payload = encoding.createEncoder();
    encoding.writeVarUint(payload, 0);
    syncProtocol.writeUpdate(payload, update);
    this.send(payload);
  }

  private sendAwareness(ids: number[]): void {
    if (!ids.length) return;
    const payload = encoding.createEncoder();
    encoding.writeVarUint(payload, 1);
    encoding.writeVarUint8Array(payload, awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids));
    this.send(payload);
  }

  private send(payload: encoding.Encoder): void {
    if (this.socket?.readyState === WebSocket.OPEN && encoding.length(payload) <= 256 * 1024) this.socket.send(encoding.toUint8Array(payload));
  }

  private setStatus(status: CollaborationStatus): void { this.status = status; for (const listener of this.listeners) listener(status); }
}

function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const palette = ["#14594D", "#8B3E24", "#4D5593", "#426929", "#8C4D74", "#27667A"];
  return palette[Math.abs(hash) % palette.length];
}
