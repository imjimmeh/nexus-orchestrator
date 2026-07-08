import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChunkBatcher } from "./chunk-batcher";

describe("ChunkBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces pushes and flushes on the interval", () => {
    const onFlush = vi.fn();
    const batcher = new ChunkBatcher(onFlush, {
      flushIntervalMs: 250,
      maxBytes: 1_000,
    });
    batcher.push("a");
    batcher.push("b");
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onFlush).toHaveBeenCalledExactlyOnceWith("ab");
  });

  it("flushes immediately when buffered bytes exceed maxBytes", () => {
    const onFlush = vi.fn();
    const batcher = new ChunkBatcher(onFlush, {
      flushIntervalMs: 10_000,
      maxBytes: 3,
    });
    batcher.push("abcd");
    expect(onFlush).toHaveBeenCalledExactlyOnceWith("abcd");
  });

  it("flush() emits buffered text once and stop() prevents further timer flushes", () => {
    const onFlush = vi.fn();
    const batcher = new ChunkBatcher(onFlush, {
      flushIntervalMs: 250,
      maxBytes: 1_000,
    });
    batcher.push("x");
    batcher.flush();
    expect(onFlush).toHaveBeenCalledExactlyOnceWith("x");
    batcher.stop();
    batcher.push("y");
    vi.advanceTimersByTime(1_000);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("never emits an empty flush", () => {
    const onFlush = vi.fn();
    const batcher = new ChunkBatcher(onFlush, { flushIntervalMs: 250 });
    batcher.flush();
    vi.advanceTimersByTime(250);
    expect(onFlush).not.toHaveBeenCalled();
  });
});
