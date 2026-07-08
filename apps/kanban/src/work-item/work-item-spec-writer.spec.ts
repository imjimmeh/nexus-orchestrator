import { describe, it, expect } from "vitest";
import { generateMarkdown } from "./work-item-spec-writer";

describe("generateMarkdown frontmatter round-trip", () => {
  const baseInput = {
    id: "0c0fa9fb-child-1",
    title: "Build shared duration-parsing utility",
    description: "# Heading\n\nBody text.",
    priority: "high",
    scope: "standard",
    status: "todo",
    dependencyIds: ["0c0fa9fb-child-0"],
    executionConfig: {},
  };

  it("emits canonical frontmatter fields", () => {
    const md = generateMarkdown(baseInput);
    expect(md).toContain("item_id: 0c0fa9fb-child-1");
    expect(md).toContain("title: Build shared duration-parsing utility");
    expect(md).toContain("priority: high");
    expect(md).toContain("scope: standard");
    expect(md).toContain("status: todo");
    expect(md).toContain("depends_on:");
    expect(md).toContain("  - 0c0fa9fb-child-0");
  });

  it("preserves custom scalar metadata keys (parent_context_id)", () => {
    const md = generateMarkdown({
      ...baseInput,
      metadata: { parent_context_id: "0c0fa9fb-parent" },
    });
    expect(md).toContain("parent_context_id: 0c0fa9fb-parent");
  });

  it("preserves custom list metadata keys (ac_ids) as a YAML list", () => {
    const md = generateMarkdown({
      ...baseInput,
      metadata: { ac_ids: ["AC-1", "AC-2", "AC-7a"] },
    });
    expect(md).toContain("ac_ids:");
    expect(md).toContain("  - AC-1");
    expect(md).toContain("  - AC-2");
    expect(md).toContain("  - AC-7a");
  });

  it("excludes internal bookkeeping metadata keys from frontmatter", () => {
    const md = generateMarkdown({
      ...baseInput,
      metadata: {
        source: "publish_specs",
        sourceId: "0c0fa9fb-child-1",
        sourcePath: "docs/work-items/0c0fa9fb-child-1.md",
        sourceHash: "deadbeef",
        workItemMarkdownPath: "docs/work-items/0c0fa9fb-child-1.md",
        parent_context_id: "0c0fa9fb-parent",
      },
    });
    expect(md).not.toContain("source:");
    expect(md).not.toContain("sourceId:");
    expect(md).not.toContain("sourcePath:");
    expect(md).not.toContain("sourceHash:");
    expect(md).not.toContain("workItemMarkdownPath:");
    // ...but still keeps the authored field
    expect(md).toContain("parent_context_id: 0c0fa9fb-parent");
  });

  it("does not duplicate canonical keys that also appear in metadata", () => {
    const md = generateMarkdown({
      ...baseInput,
      metadata: { title: "shadow", status: "shadow", depends_on: "shadow" },
    });
    expect(md).not.toContain("title: shadow");
    expect(md).not.toContain("status: shadow");
    expect(md).not.toContain("depends_on: shadow");
  });
});
