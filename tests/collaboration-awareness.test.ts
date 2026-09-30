import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createHibernationAwareness, expireStaleAwareness } from "../apps/api/src/collaboration-awareness";

describe("hibernatable collaboration presence", () => {
  it("clears the periodic awareness timer", () => {
    const awareness = createHibernationAwareness(new Y.Doc());
    expect(awareness._checkInterval).toBeUndefined();
    awareness.destroy();
  });

  it("removes expired peers on activity without scheduling a timer", () => {
    const awareness = createHibernationAwareness(new Y.Doc());
    const staleId = awareness.clientID + 1;
    const activeId = awareness.clientID + 2;
    awareness.states.set(staleId, { user: { name: "Desconectado" } });
    awareness.meta.set(staleId, { clock: 1, lastUpdated: 10_000 });
    awareness.states.set(activeId, { user: { name: "En línea" } });
    awareness.meta.set(activeId, { clock: 1, lastUpdated: 39_999 });

    expireStaleAwareness(awareness, 40_000);

    expect(awareness.states.has(staleId)).toBe(false);
    expect(awareness.states.has(activeId)).toBe(true);
    expect(awareness._checkInterval).toBeUndefined();
    awareness.destroy();
  });
});
