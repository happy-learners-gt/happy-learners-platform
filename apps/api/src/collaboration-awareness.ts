import * as awarenessProtocol from "y-protocols/awareness";
import type * as Y from "yjs";

/** Stops y-protocols' interval so an idle hibernatable Durable Object can sleep. */
export function createHibernationAwareness(doc: Y.Doc): awarenessProtocol.Awareness {
  const awareness = new awarenessProtocol.Awareness(doc);
  clearInterval(awareness._checkInterval);
  awareness._checkInterval = undefined;
  return awareness;
}

/** Presence expires on incoming events instead of a timer that prevents DO hibernation. */
export function expireStaleAwareness(awareness: awarenessProtocol.Awareness, now = Date.now()): void {
  const stale = [...awareness.meta]
    .filter(([clientId, meta]) => clientId !== awareness.clientID && awareness.states.has(clientId) && now - meta.lastUpdated >= awarenessProtocol.outdatedTimeout)
    .map(([clientId]) => clientId);
  if (stale.length) awarenessProtocol.removeAwarenessStates(awareness, stale, "timeout");
}
