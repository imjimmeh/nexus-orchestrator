import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MANIFEST_PATH = join(
  __dirname,
  "../../../../seed/tool-manifests/kanban-tools.seed.json",
);

describe("kanban tool manifest — strategic tools", () => {
  it("registers the Phase-2 strategic tool names", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      toolNames: string[];
    };
    expect(manifest.toolNames).toContain("kanban.record_strategic_intent");
    expect(manifest.toolNames).toContain("kanban.record_discovery_completed");
  });
});
