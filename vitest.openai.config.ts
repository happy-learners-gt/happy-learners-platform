import { defineConfig } from "vitest/config";
// Opt-in: real calls to OpenAI. Run through ./scripts/openai smoke <env-file>; ./scripts/verify never includes it.
export default defineConfig({ test: { include: ["tests/openai.live.ts"], testTimeout: 180000 } });
