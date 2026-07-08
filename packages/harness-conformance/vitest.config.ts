import { defineConfig } from "vitest/config";
import path from "node:path";

const fromSrc = (pkg: string): string =>
  path.resolve(__dirname, "..", pkg, "src/index.ts");

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to their TypeScript source so the conformance
      // suite is hermetic and never depends on prior `dist` builds being present.
      "@nexus/core": fromSrc("core"),
      "@nexus/harness-runtime": fromSrc("harness-runtime"),
      "@nexus/harness-engine-pi": fromSrc("harness-engine-pi"),
      "@nexus/harness-engine-claude-code": fromSrc(
        "harness-engine-claude-code",
      ),
      // Redirect the Claude Code SDK to our controllable stub so that
      // ClaudeCodeEngine's dynamic import() picks up the test double.
      "@anthropic-ai/claude-agent-sdk": path.resolve(
        __dirname,
        "test/conformance/__mocks__/claude-agent-sdk.ts",
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
  },
});
