import { describe, expect, it } from "vitest";
import { parseSpecFile } from "./spec-parser";

describe("parseSpecFile", () => {
  it("parses optional status and execution metadata", () => {
    const spec = parseSpecFile(
      "bootstrap.md",
      [
        "---",
        "item_id: bootstrap",
        "title: Bootstrap project",
        "priority: p1",
        "scope: large",
        "status: done",
        "agent_profile: senior-dev",
        "base_branch: main",
        "target_branch: feature/bootstrap",
        "context_files:",
        "  - docs/ARCHITECTURE.md",
        "depends_on:",
        "  - discovery",
        "---",
        "Implement the bootstrap work.",
      ].join("\n"),
      "docs/work-items/bootstrap.md",
    );

    expect(spec).toMatchObject({
      sourceId: "bootstrap",
      title: "Bootstrap project",
      status: "done",
      executionConfig: {
        agentProfileId: "senior-dev",
        baseBranch: "main",
        targetBranch: "feature/bootstrap",
        contextFiles: ["docs/ARCHITECTURE.md"],
      },
      dependsOnSourceIds: ["discovery"],
    });
  });

  it("parses depends_on as a comma-separated string", () => {
    const spec = parseSpecFile(
      "item.md",
      [
        "---",
        "item_id: item-a",
        "title: Item A",
        "depends_on: alpha, beta",
        "---",
        "Body.",
      ].join("\n"),
      "docs/work-items/item.md",
    );

    expect(spec.dependsOnSourceIds).toEqual(["alpha", "beta"]);
  });

  it("parses depends_on as an inline YAML array", () => {
    const spec = parseSpecFile(
      "item.md",
      [
        "---",
        "item_id: item-a",
        "title: Item A",
        "depends_on: [alpha, beta]",
        "---",
        "Body.",
      ].join("\n"),
      "docs/work-items/item.md",
    );

    expect(spec.dependsOnSourceIds).toEqual(["alpha", "beta"]);
  });

  it("returns undefined status when value is not in supported set", () => {
    const spec = parseSpecFile(
      "item.md",
      [
        "---",
        "item_id: item-b",
        "title: Item B",
        "status: invalid-status",
        "---",
        "Body.",
      ].join("\n"),
      "docs/work-items/item.md",
    );

    expect(spec.status).toBeUndefined();
  });

  it("returns undefined executionConfig when no execution fields present", () => {
    const spec = parseSpecFile(
      "item.md",
      ["---", "item_id: item-c", "title: Item C", "---", "Body."].join("\n"),
      "docs/work-items/item.md",
    );

    expect(spec.executionConfig).toBeUndefined();
  });

  it("preserves source metadata", () => {
    const content = [
      "---",
      "item_id: item-d",
      "title: Item D",
      "priority: p1",
      "scope: large",
      "custom_field: custom-value",
      "---",
      "Body.",
    ].join("\n");

    const spec = parseSpecFile(
      "item-d.md",
      content,
      "docs/work-items/item-d.md",
    );

    expect(spec.sourcePath).toBe("docs/work-items/item-d.md");
    expect(spec.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(spec.metadata).toMatchObject({
      custom_field: "custom-value",
    });
  });

  it("parses status from all supported values", () => {
    const supportedStatuses = [
      "backlog",
      "todo",
      "refinement",
      "in-progress",
      "in-review",
      "ready-to-merge",
      "blocked",
      "done",
    ];

    for (const status of supportedStatuses) {
      const spec = parseSpecFile(
        "item.md",
        [
          "---",
          "item_id: item-x",
          "title: Title",
          `status: ${status}`,
          "---",
          "Body.",
        ].join("\n"),
        "docs/work-items/item.md",
      );

      expect(spec.status).toBe(status);
    }
  });
});
