import { describe, expect, it } from "vitest";
import { summarizeToolCall } from "./summarize-tool-call";

describe("summarizeToolCall", () => {
  it("formats read_file with path and range", () => {
    expect(
      summarizeToolCall(
        "read_file",
        { path: "src/foo.ts", offset: 120, limit: 60 },
        "started",
        false,
      ),
    ).toBe("📄 read src/foo.ts:120-180 · ●");
  });
  it("formats read_file without range", () => {
    expect(
      summarizeToolCall("read_file", { path: "src/foo.ts" }, "finished", false),
    ).toBe("📄 read src/foo.ts · ✓");
  });
  it("formats write_file", () => {
    expect(
      summarizeToolCall(
        "write_file",
        { path: "src/bar.ts" },
        "finished",
        false,
      ),
    ).toBe("🗑️ write src/bar.ts · ✓");
  });
  it("formats edit_file with diff counts", () => {
    expect(
      summarizeToolCall(
        "edit_file",
        { path: "src/foo.ts", oldString: "a\nb\nc", newString: "a\nB\nc" },
        "finished",
        false,
      ),
    ).toBe("✏️ edit src/foo.ts +1/-1 · ✓");
  });
  it("formats bash with truncated long command", () => {
    const longCmd = "npm".repeat(40);
    expect(
      summarizeToolCall("bash", { command: longCmd }, "started", false),
    ).toBe(`$ ${longCmd.slice(0, 60)}… · ●`);
  });
  it("formats bash with exit code on error", () => {
    expect(
      summarizeToolCall("bash", { command: "npm test" }, "finished", true),
    ).toBe("$ npm test · ✗");
  });
  it("formats manage_todo_list with counts", () => {
    expect(
      summarizeToolCall(
        "manage_todo_list",
        {
          todos: [
            { status: "completed" },
            { status: "pending" },
            { status: "in_progress" },
          ],
        },
        "finished",
        false,
      ),
    ).toBe("☑ todos 3 items (✓ 1 done) · ✓");
  });
  it("formats delegate_* with type label", () => {
    expect(
      summarizeToolCall(
        "delegate_design_ingestion",
        { task: "x" },
        "started",
        false,
      ),
    ).toBe("🤝 delegate Design Ingestion · ●");
  });
  it("formats unknown tool with raw name", () => {
    expect(
      summarizeToolCall("mcp__foo__bar", { x: 1 }, "finished", false),
    ).toBe("mcp__foo__bar · ✓");
  });
  it("resolves harness aliases (read/Read) to the read summary", () => {
    expect(
      summarizeToolCall("read", { path: "src/foo.ts" }, "finished", false),
    ).toBe("📄 read src/foo.ts · ✓");
    expect(
      summarizeToolCall("Read", { path: "src/foo.ts" }, "finished", false),
    ).toBe("📄 read src/foo.ts · ✓");
  });
  it("formats edit with the harness edits[] shape", () => {
    expect(
      summarizeToolCall(
        "edit",
        {
          path: "src/foo.ts",
          edits: [{ oldText: "a\nb\nc", newText: "a\nB\nc" }],
        },
        "finished",
        false,
      ),
    ).toBe("✏️ edit src/foo.ts +1/-1 · ✓");
  });
  it("formats manage_todo_list from the real todo_list field", () => {
    expect(
      summarizeToolCall(
        "manage_todo_list",
        {
          todo_list: [
            { status: "completed" },
            { status: "in-progress" },
            { status: "not-started" },
          ],
        },
        "finished",
        false,
      ),
    ).toBe("☑ todos 3 items (✓ 1 done) · ✓");
  });
});
