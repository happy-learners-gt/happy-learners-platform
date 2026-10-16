/** `detail` is the error body, for answers that carry more than a message (such as the conflicts to confirm). */
export class ApiError extends Error { constructor(message: string, public status: number, public detail: Record<string, unknown> = {}) { super(message); } }

/** Fired when an authenticated request returns 401 so the shell can ask to sign in again without losing the page. */
export const sessionExpired = "hl:session-expired";
export const sessionRestored = "hl:session-restored";
/** Fired after a write succeeds, with its path, so views that list what it touched can refresh. */
export const changed = "hl:changed";
/** Fired when the terms or privacy policy in force still need the person's acceptance (ST-126, ST-127). */
export const consentRequired = "hl:consent-required";
/** Fired when teaching a class waits for the signed volunteer agreement in force (ST-151). */
export const agreementRequired = "hl:agreement-required";
const quiet = new Set(["/session", "/login", "/logout"]);

async function parse<T>(response: Response, path: string): Promise<T> {
  let result: { error?: string } & Record<string, unknown> = {};
  try { result = await response.json(); } catch { /* Non-JSON error bodies fall back to a generic message. */ }
  if (response.status === 401 && !quiet.has(path)) dispatchEvent(new CustomEvent(sessionExpired));
  if (response.status === 403 && Array.isArray(result.pending)) dispatchEvent(new CustomEvent(consentRequired));
  if (response.status === 403 && result.code === "VOLUNTEER_AGREEMENT_REQUIRED") dispatchEvent(new CustomEvent(agreementRequired));
  if (!response.ok) throw new ApiError(result.error || "No se pudo completar la operación. Vuelve a intentar.", response.status, result);
  return result as T;
}

export async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { method, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000), ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}) }); }
  catch { throw new ApiError("No pudimos conectar. Comprueba tu conexión y vuelve a intentar.", 0); }
  const result = await parse<T>(response, path);
  if (method !== "GET") dispatchEvent(new CustomEvent(changed, { detail: path }));
  return result;
}

/** Formats a course can store, with the size limit the Worker enforces for each. */
export const fileTypes: Record<string, { mediaType: string; limitMb: number }> = {
  docx: { mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", limitMb: 15 },
  pptx: { mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", limitMb: 15 },
  xlsx: { mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", limitMb: 15 },
  pdf: { mediaType: "application/pdf", limitMb: 25 },
  mp4: { mediaType: "video/mp4", limitMb: 100 },
  webm: { mediaType: "video/webm", limitMb: 100 },
};
export const fileAccept = Object.entries(fileTypes).flatMap(([extension, type]) => [`.${extension}`, type.mediaType]).join(",");
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, "0")).join("");

/** Uploads a document, PDF or video to the private course repository. */
export async function uploadCourseFile<T>(courseId: string, file: Blob, name: string): Promise<T> {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  const type = fileTypes[extension];
  if (!type) throw new ApiError("Elige un archivo DOCX, PPTX, XLSX, PDF, MP4 o WebM.", 400);
  if (file.size < 1 || file.size > type.limitMb * 1024 * 1024) throw new ApiError(`Este tipo de archivo puede pesar como máximo ${type.limitMb} MB.`, 400);
  const path = `/courses/${courseId}/files`;
  // PDF and video are streamed by the Worker; storage verifies this fingerprint while saving.
  const fingerprint: Record<string, string> = ["pdf", "mp4", "webm"].includes(extension) ? { "X-File-SHA256": hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())) } : {};
  let response: Response;
  try { response = await fetch(`/api${path}`, { method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(type.limitMb > 15 ? 300000 : 45000), headers: { "Content-Type": type.mediaType, "X-File-Name": encodeURIComponent(name), "Idempotency-Key": crypto.randomUUID(), ...fingerprint }, body: file }); }
  catch { throw new ApiError("No pudimos subir el archivo. Comprueba tu conexión y vuelve a intentar.", 0); }
  return parse<T>(response, path);
}

export async function archiveCourseFile(courseId: string, fileId: string) {
  const path = `/courses/${courseId}/files/${fileId}/archive`;
  let response: Response;
  try { response = await fetch(`/api${path}`, { method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000) }); }
  catch { throw new ApiError("No pudimos conectar. Comprueba tu conexión y vuelve a intentar.", 0); }
  return parse<{ ok: true }>(response, path);
}

export const message = (error: unknown) => error instanceof Error ? error.message : "No se pudo completar la operación. Vuelve a intentar.";
