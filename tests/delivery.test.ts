import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const workflow = parse(readFileSync(".github/workflows/repository.yml", "utf8"));
describe("delivery gate", () => {
  it("verifies PRs and main pushes, and requires a successful verification before deploying", () => {
    expect(workflow.on).toEqual({ pull_request: null, push: { branches: ["main"] } });
    expect(workflow.jobs.verify.steps.some((step: { run?: string }) => step.run === "./scripts/verify")).toBe(true);
    expect(workflow.jobs.deploy.needs).toBe("verify");
    for (const job of Object.values(workflow.jobs)) {
      expect(job).not.toHaveProperty("environment");
    }
    const deployStep = workflow.jobs.deploy.steps.find((step: { name?: string }) => step.name === "Deploy verified package");
    expect(deployStep.env).toEqual({
      CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    });
    expect(workflow.jobs.deploy.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    for (const step of workflow.jobs.verify.steps) expect(step["continue-on-error"]).toBeUndefined();
    expect(workflow.jobs.verify["continue-on-error"]).toBeUndefined();
    expect(JSON.stringify(workflow.jobs.verify)).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(JSON.stringify(workflow.jobs.verify)).not.toContain("wrangler deploy --config");
  });
  it("delivers the artifact from the same run without rebuilding it", () => {
    const upload = workflow.jobs.verify.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/upload-artifact@"));
    const download = workflow.jobs.deploy.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/download-artifact@"));
    expect(upload.with.name).toBe("demo-${{ github.sha }}");
    expect(download.with.name).toBe(upload.with.name);
    expect(JSON.stringify(workflow.jobs.deploy)).not.toContain("npm run build");
    const manifest = JSON.parse(readFileSync("build/version.json", "utf8"));
    expect(manifest.sha).toBe(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
    expect(readFileSync("build/worker/index.js", "utf8")).toContain(manifest.sha);
    const config = JSON.parse(readFileSync("build/wrangler.json", "utf8"));
    expect(config.no_bundle).toBe(true);
    expect(config.assets.directory).toBe("web");
    expect(config.d1_databases).toBeUndefined();
    expect(config.r2_buckets).toBeUndefined();
  });
  it("rejects a build with a SHA different from the checkout", () => {
    expect(() => execFileSync(process.execPath, ["scripts/build.mjs"], {
      env: { ...process.env, GITHUB_SHA: "0".repeat(40) }, stdio: "pipe",
    })).toThrow();
  });
});
