import { describe, it, expect, vi } from "vitest";
import { ClaudeCodeSession } from "../src/claude-code-session.js";
import { ClaudeEventMapper } from "../src/map-claude-event.js";
import { ClaudeV3Mapper } from "../src/map-claude-message-to-v3.js";

function scriptedGen(messages: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    for (const m of messages) yield m;
  })();
}

describe("ClaudeCodeSession v3 sink", () => {
  it("appends a v3 node for each mapped SDK message via the injected sink", async () => {
    const appended: unknown[] = [];
    const sink = {
      appendNode: vi.fn((p: unknown) => {
        appended.push(p);
        return "id";
      }),
    };
    const v3mapper = new ClaudeV3Mapper({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });

    const gen = scriptedGen([
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
      },
      { type: "result", subtype: "success", result: "done" },
    ]);
    const session = new ClaudeCodeSession(
      gen,
      new ClaudeEventMapper("step"),
      "step",
      {
        v3Sink: sink,
        v3Mapper: v3mapper,
      },
    );
    await new Promise((r) => setTimeout(r, 10));
    await session.dispose();

    expect(sink.appendNode).toHaveBeenCalledTimes(1);
  });

  it("does not throw if the sink append fails (best-effort persistence)", async () => {
    const sink = {
      appendNode: vi.fn(() => {
        throw new Error("disk full");
      }),
    };
    const v3mapper = new ClaudeV3Mapper({ provider: "anthropic", model: "m" });
    const gen = scriptedGen([
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "x" }] },
      },
    ]);
    const session = new ClaudeCodeSession(
      gen,
      new ClaudeEventMapper("s"),
      "s",
      { v3Sink: sink, v3Mapper: v3mapper },
    );
    await new Promise((r) => setTimeout(r, 10));
    await expect(session.dispose()).resolves.toBeUndefined();
  });
});
