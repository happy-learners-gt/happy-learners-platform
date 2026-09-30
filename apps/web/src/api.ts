export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

/** Fired when an authenticated request returns 401 so the shell can ask to sign in again without losing the page. */
export const sessionExpired = "hl:session-expired";
export const sessionRestored = "hl:session-restored";
const quiet = new Set(["/session", "/login", "/logout"]);

async function parse<T>(response: Response, path: string): Promise<T> {
  let result: { error?: string } = {};
  try { result = await response.json(); } catch { /* Non-JSON error bodies fall back to a generic message. */ }
  if (response.status === 401 && !quiet.has(path)) dispatchEvent(new CustomEvent(sessionExpired));
  if (!response.ok) throw new ApiError(result.error || "No se pudo completar la operación. Vuelve a intentar.", response.status);
  return result as T;
}

export async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { method, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000), ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}) }); }
  catch { throw new ApiError("No pudimos conectar. Comprueba tu conexión y vuelve a intentar.", 0); }
  return parse<T>(response, path);
}

const officeTypes: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export const officeAccept = `.docx,.pptx,.xlsx,${Object.values(officeTypes).join(",")}`;

/** Uploads a DOCX, PPTX or XLSX to the private course repository. */
export async function uploadCourseFile<T>(courseId: string, file: Blob, name: string): Promise<T> {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  if (!officeTypes[extension]) throw new ApiError("Elige un archivo DOCX, PPTX o XLSX.", 400);
  if (file.size < 1 || file.size > 15 * 1024 * 1024) throw new ApiError("El archivo debe pesar como máximo 15 MB.", 400);
  const path = `/courses/${courseId}/files`;
  let response: Response;
  try { response = await fetch(`/api${path}`, { method: "POST", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(45000), headers: { "Content-Type": officeTypes[extension], "X-File-Name": encodeURIComponent(name), "Idempotency-Key": crypto.randomUUID() }, body: file }); }
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
