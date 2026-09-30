import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const workflow = parse(readFileSync(".github/workflows/repository.yml", "utf8"));
describe("delivery gate", () => {
  it("never runs the content-writing E2E suite against production", () => {
    const checks = workflow.jobs["critical-flows"].steps;
    expect(checks.find((step: { run?: string }) => step.run === "npm run test:smoke").env.BASE_URL).toMatch(/^https:/);
    expect(checks.some((step: { run?: string }) => step.run === "npm run test:e2e")).toBe(false);
    const e2e = workflow.jobs.verify.steps.find((step: { run?: string }) => step.run === "npm run test:e2e");
    expect(e2e.env?.BASE_URL).toBeUndefined();
  });
  it("verifies PRs and main pushes, and requires a successful verification before deploying", () => {
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on.schedule).toEqual([{ cron: "17 * * * *" }]);
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
    expect(workflow.jobs.deploy.if).toBe("(github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'");
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
    expect(config.durable_objects.bindings).toEqual([
      { name: "ORGANIZATIONS", class_name: "OrganizationStore" },
      { name: "LESSON_ROOMS", class_name: "LessonCollaborationRoom" },
    ]);
    expect(config.migrations).toEqual([
      { tag: "v1", new_sqlite_classes: ["OrganizationStore"] },
      { tag: "v2", new_sqlite_classes: ["LessonCollaborationRoom"] },
    ]);
    expect(config.r2_buckets).toEqual([{ binding: "COURSE_FILES", bucket_name: "happy-learners-demo-course-files" }]);
    const deploySteps = workflow.jobs.deploy.steps;
    const bucket = deploySteps.findIndex((step: { name?: string }) => step.name === "Ensure private course-file bucket exists");
    const publish = deploySteps.findIndex((step: { name?: string }) => step.name === "Deploy verified package");
    const start = deploySteps.findIndex((step: { id?: string }) => step.id === "deployment");
    expect(bucket).toBeGreaterThan(-1);
    expect(start).toBeLessThan(bucket);
    expect(bucket).toBeLessThan(publish);
    expect(deploySteps[bucket].run).toContain("wrangler r2 bucket list");
    expect(deploySteps[bucket].run).toContain("wrangler r2 bucket create");
    expect(deploySteps[bucket].env).toEqual({
      CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
      CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
    });
  });
  it("reports deployment status with the repository token and maps demo to Jira testing", () => {
    expect(workflow.jobs.deploy.permissions).toEqual({ contents: "read", deployments: "write" });
    const steps = workflow.jobs.deploy.steps;
    const start = steps.findIndex((step: { id?: string }) => step.id === "deployment");
    const delivery = steps.findIndex((step: { id?: string }) => step.id === "cloudflare");
    expect(start).toBeLessThan(delivery);
    expect(steps[start].env).toEqual({ GH_TOKEN: "${{ github.token }}" });
    const finish = steps[steps.length - 1];
    expect(finish.if).toBe("always() && steps.deployment.outputs.id != ''");
    expect(finish.env.DEPLOY_OUTCOME).toBe("${{ steps.cloudflare.outcome == 'skipped' && steps.bucket.outcome || steps.cloudflare.outcome }}");
    expect(finish.env.DEPLOYMENT_ID).toBe("${{ steps.deployment.outputs.id }}");
    const jira = parse(readFileSync(".jira/config.yml", "utf8"));
    expect(jira.deployments.environmentMapping.testing).toEqual(["demo"]);
  });
  it("rejects a build with a SHA different from the checkout", () => {
    expect(() => execFileSync(process.execPath, ["scripts/build.mjs"], {
      env: { ...process.env, GITHUB_SHA: "0".repeat(40) }, stdio: "pipe",
    })).toThrow();
  });
});
