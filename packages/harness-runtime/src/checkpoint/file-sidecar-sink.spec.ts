import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSidecarSink } from "./file-sidecar-sink.js";

describe("FileSidecarSink", () => {
  it("appends fsync'd JSONL markers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ckpt-"));
    const sink = new FileSidecarSink(join(dir, "checkpoints.jsonl"));
    await sink.write({
      engine: "pi",
      phase: "intent",
      callSeq: 1,
      toolName: "a",
    });
    await sink.write({
      engine: "pi",
      phase: "result",
      callSeq: 1,
      toolName: "a",
    });
    const lines = (await readFile(join(dir, "checkpoints.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(JSON.parse(lines[0])).toMatchObject({ phase: "intent", callSeq: 1 });
    expect(JSON.parse(lines[1])).toMatchObject({ phase: "result", callSeq: 1 });
  });
});
