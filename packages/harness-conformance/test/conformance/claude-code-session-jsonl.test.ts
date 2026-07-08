import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { V3SessionWriter } from "@nexus/harness-runtime";
import { ClaudeV3Mapper } from "@nexus/harness-engine-claude-code";

const here = fileURLToPath(new URL(".", import.meta.url));

function deterministicOpts() {
  let n = 0;
  return { genId: () => `node${++n}`, now: () => "2026-06-15T00:00:00.000Z" };
}

const CLAUDE_STREAM = [
  {
    type: "assistant",
    message: {
      id: "resp_1",
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 1,
      },
      content: [
        { type: "text", text: "Calling a tool" },
        {
          type: "tool_use",
          id: "call_1",
          name: "kanban_project_state",
          input: { max: 100 },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "call_1",
          content: '{"ok":true}',
          is_error: false,
        },
      ],
    },
  },
  { type: "result", subtype: "success", result: "done" },
];

function normalize(node: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...node };
  if ("id" in clone) clone.id = "<ID>";
  if ("parentId" in clone)
    clone.parentId = clone.parentId === null ? null : "<PID>";
  if ("timestamp" in clone) clone.timestamp = "<TS>";
  return clone;
}

describe("claude-code session JSONL conformance", () => {
  it("produces v3 nodes that satisfy validation invariants and match the golden fixture", () => {
    const sessionPath = join(
      mkdtempSync(join(tmpdir(), "conf-")),
      "session.jsonl",
    );
    const writer = V3SessionWriter.create(
      sessionPath,
      "/workspace",
      deterministicOpts(),
    );
    writer.appendNode({
      type: "model_change",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
    const mapper = new ClaudeV3Mapper({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
    for (const msg of CLAUDE_STREAM)
      for (const node of mapper.map(msg)) writer.appendNode(node);

    const produced = readFileSync(sessionPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    for (const node of produced) {
      expect(node.id).toBeTruthy();
      expect(node.type).toBeTruthy();
    }
    const ids = new Set(produced.map((n) => n.id));
    for (const node of produced) {
      const parent = (node.parentId ?? null) as string | null;
      if (parent) expect(ids.has(parent)).toBe(true);
    }
    const golden = readFileSync(
      join(here, "__fixtures__/claude-v3-golden.jsonl"),
      "utf-8",
    )
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(produced.map(normalize)).toEqual(golden.map(normalize));
  });
});
