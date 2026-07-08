import { describe, it, expect } from "vitest";
import {
  isErrorEnvelope,
  toErrorEnvelope,
  errorEnvelopeToString,
  ErrorEnvelope,
} from "./error-envelope.types";

describe("isErrorEnvelope", () => {
  it("returns true for a valid envelope object", () => {
    const envelope: ErrorEnvelope = { kind: "worktree.stale", path: "/tmp/x" };
    expect(isErrorEnvelope(envelope)).toBe(true);
  });

  it("returns false for a plain Error", () => {
    expect(isErrorEnvelope(new Error("boom"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isErrorEnvelope(null)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isErrorEnvelope("error text")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isErrorEnvelope(undefined)).toBe(false);
  });
});

describe("toErrorEnvelope", () => {
  it("returns the envelope as-is when already an ErrorEnvelope", () => {
    const envelope: ErrorEnvelope = {
      kind: "worktree.lock",
      path: "/p",
      hint: "use -f -f",
    };
    expect(toErrorEnvelope(envelope)).toBe(envelope);
  });

  it("wraps a plain Error in kind:unknown", () => {
    const err = new Error("something went wrong");
    const result = toErrorEnvelope(err);
    expect(result).toEqual({
      kind: "unknown",
      message: "something went wrong",
      raw: err,
    });
  });

  it("wraps a string in kind:unknown", () => {
    const result = toErrorEnvelope("raw string error");
    expect(result).toEqual({
      kind: "unknown",
      message: "raw string error",
      raw: "raw string error",
    });
  });

  it("wraps an unknown object in kind:unknown", () => {
    const obj = { foo: "bar" };
    const result = toErrorEnvelope(obj);
    expect(result.kind).toBe("unknown");
    expect(result).toHaveProperty("raw", obj);
  });
});

describe("errorEnvelopeToString", () => {
  it("formats worktree.lock", () => {
    const msg = errorEnvelopeToString({
      kind: "worktree.lock",
      path: "/p",
      hint: "use -f -f",
    });
    expect(msg).toContain("/p");
    expect(msg).toContain("use -f -f");
  });

  it("formats worktree.stale", () => {
    const msg = errorEnvelopeToString({ kind: "worktree.stale", path: "/p" });
    expect(msg).toContain("/p");
  });

  it("formats worktree.io", () => {
    const msg = errorEnvelopeToString({
      kind: "worktree.io",
      path: "/p",
      errno: "EIO",
    });
    expect(msg).toContain("EIO");
    expect(msg).toContain("/p");
  });

  it("formats worktree.branch-missing", () => {
    const msg = errorEnvelopeToString({
      kind: "worktree.branch-missing",
      branch: "main",
      remote: "origin",
    });
    expect(msg).toContain("main");
    expect(msg).toContain("origin");
  });

  it("formats transition.illegal", () => {
    const msg = errorEnvelopeToString({
      kind: "transition.illegal",
      from: "done",
      to: "in-review",
    });
    expect(msg).toContain("done");
    expect(msg).toContain("in-review");
  });

  it("formats transition.stale", () => {
    const msg = errorEnvelopeToString({
      kind: "transition.stale",
      from: "in-review",
      requested: "in-review",
      current: "done",
    });
    expect(msg).toBe(
      "Stale status transition: requested in-review but current status is done (was in-review)",
    );
  });

  it("formats provider.quota with retryAfterMs", () => {
    const msg = errorEnvelopeToString({
      kind: "provider.quota",
      provider: "openai",
      retryAfterMs: 5000,
    });
    expect(msg).toContain("openai");
    expect(msg).toContain("5000");
  });

  it("formats provider.quota without retryAfterMs", () => {
    const msg = errorEnvelopeToString({
      kind: "provider.quota",
      provider: "anthropic",
    });
    expect(msg).toContain("anthropic");
  });

  it("formats tool.io", () => {
    const msg = errorEnvelopeToString({
      kind: "tool.io",
      toolName: "bash",
      errno: "ENOENT",
    });
    expect(msg).toContain("bash");
    expect(msg).toContain("ENOENT");
  });

  it("formats unknown", () => {
    const msg = errorEnvelopeToString({ kind: "unknown", message: "oops" });
    expect(msg).toBe("oops");
  });
});
