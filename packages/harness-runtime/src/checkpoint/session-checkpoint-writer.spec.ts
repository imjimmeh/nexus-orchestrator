import { describe, it, expect, vi } from "vitest";
import { SessionCheckpointWriter } from "./session-checkpoint-writer.js";
import type { CheckpointSink } from "./session-checkpoint-writer.types.js";
import type { CanonicalSessionEvent } from "@nexus/core";

function fakeSession() {
  const handlers = new Set<(e: CanonicalSessionEvent) => void>();
  return {
    subscribe: (h: (e: CanonicalSessionEvent) => void) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    emit: (e: CanonicalSessionEvent) => {
      handlers.forEach((h) => {
        h(e);
      });
    },
    prompt: async () => {},
    abort: async () => {},
    dispose: async () => {},
  };
}

describe("SessionCheckpointWriter", () => {
  it("emits intent before tool result, sharing callSeq via toolCallId", async () => {
    const sink: CheckpointSink = {
      write: vi.fn().mockResolvedValue(undefined),
    };
    const session = fakeSession();
    const writer = new SessionCheckpointWriter(session, sink, {
      engine: "pi",
      getSessionRef: () => ({ kind: "pi", treeId: "t1", resumeNodeId: "n4" }),
    });
    writer.start();

    session.emit({
      type: "tool_execution_start",
      stepId: "s1",
      toolCallId: "c1",
      toolName: "fs.write",
      args: { title: "x" },
    });
    session.emit({
      type: "tool_execution_end",
      stepId: "s1",
      toolCallId: "c1",
      toolName: "fs.write",
      result: { id: "wi1" },
      isError: false,
    });
    await Promise.resolve();

    const calls = (sink.write as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(calls[0]).toMatchObject({
      phase: "intent",
      callSeq: 1,
      toolName: "fs.write",
    });
    expect(calls[1]).toMatchObject({ phase: "result", callSeq: 1 });
    expect(calls[0].idempotencyKey).toEqual(expect.any(String));
  });

  it("increments callSeq across distinct tool calls", async () => {
    const sink: CheckpointSink = {
      write: vi.fn().mockResolvedValue(undefined),
    };
    const session = fakeSession();
    new SessionCheckpointWriter(session, sink, {
      engine: "pi",
      getSessionRef: () => null,
    }).start();
    session.emit({
      type: "tool_execution_start",
      stepId: "s1",
      toolCallId: "c1",
      toolName: "a",
      args: {},
    });
    session.emit({
      type: "tool_execution_start",
      stepId: "s1",
      toolCallId: "c2",
      toolName: "b",
      args: {},
    });
    await Promise.resolve();
    const calls = (sink.write as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(calls[0].callSeq).toBe(1);
    expect(calls[1].callSeq).toBe(2);
  });

  it("stops recording after stop()", async () => {
    const sink: CheckpointSink = {
      write: vi.fn().mockResolvedValue(undefined),
    };
    const session = fakeSession();
    const writer = new SessionCheckpointWriter(session, sink, {
      engine: "pi",
      getSessionRef: () => null,
    });
    writer.start();
    writer.stop();
    session.emit({
      type: "tool_execution_start",
      stepId: "s1",
      toolCallId: "c1",
      toolName: "fs.read",
      args: {},
    });
    await Promise.resolve();
    expect((sink.write as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("does not throw when the sink rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const writeMock = vi.fn().mockRejectedValue(new Error("disk full"));
    const sink: CheckpointSink = { write: writeMock };
    const session = fakeSession();
    new SessionCheckpointWriter(session, sink, {
      engine: "pi",
      getSessionRef: () => null,
    }).start();
    expect(() => {
      session.emit({
        type: "tool_execution_start",
        stepId: "s1",
        toolCallId: "c1",
        toolName: "fs.read",
        args: {},
      });
    }).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeMock).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
