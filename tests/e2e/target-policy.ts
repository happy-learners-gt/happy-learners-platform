/** Content-writing tests may only use the disposable server owned by Playwright. */
export function assertLocalTestTarget(external: string | undefined) {
  if (external !== undefined) throw new Error("Content-writing E2E tests cannot use BASE_URL. Run test:smoke for a remote target.");
}

export function permitsSmokeRequest(method: string, url: string, origin: string) {
  const target = new URL(url);
  if (target.origin !== origin) return false;
  return ["GET", "HEAD"].includes(method) || (method === "POST" && ["/api/login", "/api/logout"].includes(target.pathname));
}
