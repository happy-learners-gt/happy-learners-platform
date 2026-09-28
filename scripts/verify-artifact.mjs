import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const manifest = JSON.parse(readFileSync("build/integrity.json", "utf8"));
if (manifest.sha !== process.env.GITHUB_SHA) throw new Error("Artifact SHA mismatch");
for (const file of manifest.files) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(file.path) || file.path.split("/").includes("..")) throw new Error("Invalid artifact path");
  const actual = createHash("sha256").update(readFileSync("build/" + file.path)).digest("hex");
  if (actual !== file.sha256) throw new Error("Artifact content mismatch");
}
console.log(JSON.stringify({ sha: manifest.sha, verified_files: manifest.files.length }));
