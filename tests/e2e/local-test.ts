import { test as base, expect } from "@playwright/test";
import { assertLocalTestTarget } from "./target-policy";

export const test = base.extend<{ localOnly: void }>({
  localOnly: [async ({ context }, use) => {
    assertLocalTestTarget(process.env.BASE_URL);
    // Also prevent browser redirects or links from sending writes to a remote host.
    await context.route("**/*", route => {
      const request = route.request();
      const local = new URL(request.url()).origin === "http://127.0.0.1:8789";
      return local ? route.continue() : route.abort("blockedbyclient");
    });
    await use();
  }, { auto: true }],
});
export { expect };
