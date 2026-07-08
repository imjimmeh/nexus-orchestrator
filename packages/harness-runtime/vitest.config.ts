import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Redirect the Claude Code SDK to our controllable stub so that
      // ClaudeCodeEngine's dynamic import() picks up the test double.
      "@anthropic-ai/claude-agent-sdk": path.resolve(
        __dirname,
        "test/conformance/__mocks__/claude-agent-sdk.ts",
      ),
      // Resolve the Claude Code engine package from its source so that
      // the harness-runtime conformance test can import it without a workspace
      // symlink (Vitest transpiles TypeScript natively, so pointing at the src
      // is correct for the test environment).
      "@nexus/harness-engine-claude-code": path.resolve(
        __dirname,
        "../../packages/harness-engine-claude-code/src/index.ts",
      ),
    },
  },
  test: {
    include: ["src/**/*.spec.ts", "test/**/*.test.ts"],
    globals: false,
  },
});
