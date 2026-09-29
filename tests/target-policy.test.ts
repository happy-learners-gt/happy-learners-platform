import { describe, expect, it } from "vitest";
import { assertLocalTestTarget, permitsSmokeRequest } from "./e2e/target-policy";

describe("demo data protection", () => {
  it("permits writes only against the managed test server", () => {
    expect(() => assertLocalTestTarget(undefined)).not.toThrow();
    for (const url of ["", "http://127.0.0.1:8789", "https://happy-learners-demo.lfmendoza-alvarez.workers.dev"])
      expect(() => assertLocalTestTarget(url)).toThrow(/cannot use BASE_URL/);
  });
  it("allows smoke reads and session lifecycle, never content or completion writes", () => {
    const origin = "https://example.test";
    expect(permitsSmokeRequest("GET", origin + "/api/lessons", origin)).toBe(true);
    for (const path of ["/api/login", "/api/logout"]) expect(permitsSmokeRequest("POST", origin + path, origin)).toBe(true);
    for (const path of ["/api/resources", "/api/lessons", "/api/levels", "/api/organization", "/api/share/GREETINGS/complete", "/api/lessons/id/publish"])
      for (const method of ["POST", "PUT", "PATCH", "DELETE"])
        expect(permitsSmokeRequest(method, origin + path, origin)).toBe(false);
    expect(permitsSmokeRequest("GET", "https://elsewhere.test", origin)).toBe(false);
  });
});
