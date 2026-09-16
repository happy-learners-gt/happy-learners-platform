import { useEffect, useState } from "react";
import type { HealthResponse, VersionResponse } from "@happy-learners/contracts";

export function App() {
  const [sha, setSha] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let active = true;
    async function load() {
      try {
        const options = { signal: controller.signal, cache: "no-store" as const };
        const [health, version] = await Promise.all([
          fetch("/api/health", options), fetch("/api/version", options),
        ]);
        if (!health.ok || !version.ok) throw new Error("Unavailable");
        const healthData: HealthResponse = await health.json();
        const versionData: VersionResponse = await version.json();
        if (healthData.status !== "ok" || !/^[a-f0-9]{40}$/.test(versionData.sha)) {
          throw new Error("Invalid response");
        }
        if (active) setSha(versionData.sha);
      } catch {
        if (active) setFailed(true);
      } finally { clearTimeout(timer); }
    }
    void load();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, []);
  return <main>
    <h1>Happy Learners</h1>
    <p role="status">{failed ? "No pudimos comprobar la disponibilidad. Intenta recargar la página." : sha ? "Happy Learners está disponible." : "Comprobando disponibilidad…"}</p>
    {sha && <p>Versión desplegada: <code>{sha}</code></p>}
  </main>;
}
