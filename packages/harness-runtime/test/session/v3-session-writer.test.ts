import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { V3SessionWriter } from "../../src/session/v3-session-writer.js";

function deterministicOpts() {
  let n = 0;
  return { genId: () => `id${++n}`, now: () => "2026-06-15T00:00:00.000Z" };
}

function readLines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("V3SessionWriter", () => {
  let sessionPath: string;
  beforeEach(() => {
    sessionPath = join(mkdtempSync(join(tmpdir(), "v3-")), "session.jsonl");
  });

  it("create() writes a v3 session header", () => {
    V3SessionWriter.create(sessionPath, "/workspace", deterministicOpts());
    const [header] = readLines(sessionPath);
    expect(header).toMatchObject({
      type: "session",
      version: 3,
      id: "id1",
      cwd: "/workspace",
    });
  });

  it("appendNode() assigns id, links parentId to the previous node, and chains linearly", () => {
    const w = V3SessionWriter.create(
      sessionPath,
      "/workspace",
      deterministicOpts(),
    );
    const firstId = w.appendNode({
      type: "model_change",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
    const secondId = w.appendNode({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    });
    const lines = readLines(sessionPath);
    expect(firstId).toBe("id2");
    expect(secondId).toBe("id3");
    expect(lines[1]).toMatchObject({
      type: "model_change",
      id: "id2",
      parentId: null,
    });
    expect(lines[2]).toMatchObject({
      type: "message",
      id: "id3",
      parentId: "id2",
    });
    expect(lines[2].message).toMatchObject({ role: "user" });
  });

  it("every emitted node has a truthy id and type (downstream validation invariant)", () => {
    const w = V3SessionWriter.create(
      sessionPath,
      "/workspace",
      deterministicOpts(),
    );
    w.appendNode({ type: "model_change", provider: "anthropic", modelId: "m" });
    for (const node of readLines(sessionPath)) {
      expect(node.id).toBeTruthy();
      expect(node.type).toBeTruthy();
    }
  });

  it("open() seeds the parent pointer from the last node so resume continues the chain", () => {
    const w1 = V3SessionWriter.create(
      sessionPath,
      "/workspace",
      deterministicOpts(),
    );
    w1.appendNode({
      type: "model_change",
      provider: "anthropic",
      modelId: "m",
    }); // id2
    w1.appendNode({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "a" }] },
    }); // id3 (last)

    const resumeOpts = (() => {
      let n = 100;
      return { genId: () => `r${++n}`, now: () => "2026-06-15T01:00:00.000Z" };
    })();
    const w2 = V3SessionWriter.open(sessionPath, resumeOpts);
    w2.appendNode({
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "b" }] },
    }); // r101
    const lines = readLines(sessionPath);
    const appended = lines[lines.length - 1];
    expect(appended).toMatchObject({ id: "r101", parentId: "id3" });
  });
});
