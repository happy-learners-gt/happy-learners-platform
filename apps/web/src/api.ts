export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { method, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000), ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}) }); }
  catch { throw new ApiError("No pudimos conectar. Comprueba tu conexión y vuelve a intentar.", 0); }
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error || "No se pudo completar la operación.", response.status);
  return result as T;
}
