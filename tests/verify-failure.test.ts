import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("stops verification immediately when type checking fails", () => {
  const fixture = mkdtempSync(join(tmpdir(), "st043-verify-"));
  try {
    for (const directory of ["scripts", "bin", "apps/web", "apps/api", "packages/domain", "packages/contracts", "database/migrations", "infrastructure", "tests"]) {
      mkdirSync(join(fixture, directory), { recursive: true });
      writeFileSync(join(fixture, directory, "README.md"), "fixture\n");
    }
    writeFileSync(join(fixture, "scripts/verify"), readFileSync("scripts/verify"));
    // Replace only tool execution: a failing checker must prevent tests and packaging.
    writeFileSync(join(fixture, "bin/npm"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$VERIFY_CALLS"\nif [[ "$*" == "run typecheck" ]]; then exit 23; fi\n', { mode: 0o755 });
    writeFileSync(join(fixture, "bin/npx"), '#!/usr/bin/env bash\necho unexpected-npx >> "$VERIFY_CALLS"\n', { mode: 0o755 });
    const calls = join(fixture, "calls");
    const result = spawnSync("bash", [join(fixture, "scripts/verify")], {
      env: { ...process.env, PATH: `${join(fixture, "bin")}:${process.env.PATH}`, VERIFY_CALLS: calls }, encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(23);
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["run build", "run types", "run typecheck"]);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
