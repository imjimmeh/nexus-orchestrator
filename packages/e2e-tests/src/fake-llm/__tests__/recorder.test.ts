// packages/e2e-tests/src/fake-llm/__tests__/recorder.test.ts
import { describe, expect, it } from "vitest";
import { createRequestRecorder } from "../recorder.js";
import type { CanonicalRequest } from "../types.js";

function req(overrides: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    protocol: "openai",
    model: "m",
    system: "",
    messages: [],
    tools: [],
    stream: false,
    rawBody: {},
    headers: {},
    ...overrides,
  };
}

describe("createRequestRecorder", () => {
  it("assigns a monotonic index and returns the recorded request", () => {
    const recorder = createRequestRecorder();
    const first = recorder.record(req());
    const second = recorder.record(req());
    expect(first.index).toBe(0);
    expect(second.index).toBe(1);
    expect(recorder.count()).toBe(2);
  });

  it("filters by protocol and returns the last for a protocol", () => {
    const recorder = createRequestRecorder();
    recorder.record(req({ protocol: "openai", model: "a" }));
    recorder.record(req({ protocol: "anthropic", model: "b" }));
    recorder.record(req({ protocol: "anthropic", model: "c" }));
    expect(recorder.forProtocol("anthropic").map((r) => r.model)).toEqual([
      "b",
      "c",
    ]);
    expect(recorder.lastFor("anthropic")?.model).toBe("c");
    expect(recorder.lastFor("openai")?.model).toBe("a");
  });

  it("reset() clears the log and restarts indexing", () => {
    const recorder = createRequestRecorder();
    recorder.record(req());
    recorder.reset();
    expect(recorder.count()).toBe(0);
    expect(recorder.record(req()).index).toBe(0);
  });
});
