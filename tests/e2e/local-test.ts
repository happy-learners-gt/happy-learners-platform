import { test as base, expect } from "@playwright/test";
import { assertLocalTestTarget } from "./target-policy";

export const test = base.extend<{ localOnly: void; noCspViolations: void }>({
  localOnly: [async ({ context }, use) => {
    assertLocalTestTarget(process.env.BASE_URL);
    // Also prevent browser redirects or links from sending writes to a remote host.
    await context.route("**/*", route => {
      const request = route.request();
      const local = new URL(request.url()).origin === `http://127.0.0.1:${Number(process.env.HL_E2E_PORT || 8789)}`;
      return local ? route.continue() : route.abort("blockedbyclient");
    });
    await use();
  }, { auto: true }],
  // Pages run under the production Content-Security-Policy; anything it blocks fails the test.
  noCspViolations: [async ({ context }, use) => {
    const violations: string[] = [];
    context.on("console", message => { if (/Content Security Policy|Refused to (load|execute|apply|connect|create|frame)/i.test(message.text())) violations.push(message.text()); });
    context.on("page", page => page.on("console", message => { if (/Content Security Policy|Refused to (load|execute|apply|connect|create|frame)/i.test(message.text())) violations.push(message.text()); }));
    await use();
    expect([...new Set(violations)], "Content-Security-Policy violations").toEqual([]);
  }, { auto: true }],
});
export { expect };
