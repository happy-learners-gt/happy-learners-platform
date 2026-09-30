// Adapts a verified artifact for the pull-request preview. Run after scripts/verify-artifact.mjs.
// The preview is a separate Worker with its own Durable Objects (fresh demo data) and its own private
// R2 bucket, so reviewing a PR can never read or write production data.
import { readFileSync, writeFileSync } from "node:fs";

export const previewName = "happy-learners-demo-preview";
export const previewBucket = "happy-learners-demo-preview-files";

const path = "build/wrangler.json";
const config = JSON.parse(readFileSync(path, "utf8"));
if (config.name !== "happy-learners-demo") throw new Error("Unexpected Worker name in the artifact");
config.name = previewName;
config.r2_buckets = config.r2_buckets.map(bucket => bucket.binding === "COURSE_FILES" ? { ...bucket, bucket_name: previewBucket } : bucket);
writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
console.log(JSON.stringify({ worker: config.name, bucket: previewBucket }));
