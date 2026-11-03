import { once } from "node:events";
import type { Server } from "node:net";

/**
 * QA-05: the port of a test Worker, outside Linux's ephemeral range (32768–60999). Asking the system for port 0 and
 * closing it left the port free for the ephemeral ports each Worker opens for itself, and under load another test's
 * Worker took it first ("Address already in use"). A busy port is skipped.
 */
export async function listenOnTestPort(server: Server) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 12000);
    try {
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
      return;
    } catch { /* Taken: try another. */ }
  }
  throw new Error("No free port for the test Worker");
}
