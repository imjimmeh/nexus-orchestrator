import { describe, expect, it } from "vitest";
import {
  extractToolResultText,
  normalizeToolResult,
  toDisplayText,
} from "./tool-result-content";

describe("normalizeToolResult", () => {
  it("returns empty for undefined / null", () => {
    expect(normalizeToolResult(undefined).kind).toBe("empty");
    expect(normalizeToolResult(null).kind).toBe("empty");
  });

  it("returns plain strings as text", () => {
    const result = normalizeToolResult("hello\nworld");
    expect(result).toEqual({ kind: "text", text: "hello\nworld" });
  });

  it("unwraps the Anthropic content-block envelope into joined text", () => {
    const result = normalizeToolResult({
      content: [{ type: "text", text: "import { x } from 'y';" }],
    });
    expect(result).toEqual({ kind: "text", text: "import { x } from 'y';" });
  });

  it("joins multiple text blocks with newlines", () => {
    const result = normalizeToolResult({
      content: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ],
    });
    expect(result).toEqual({ kind: "text", text: "line one\nline two" });
  });

  it("parses JSON hidden inside a text block into structured json", () => {
    const result = normalizeToolResult({
      content: [{ type: "text", text: '{"ok":true,"count":3}' }],
    });
    expect(result).toEqual({ kind: "json", value: { ok: true, count: 3 } });
  });

  it("unwraps double-wrapped content envelopes (Nexus tools)", () => {
    const inner = JSON.stringify({
      content: [{ type: "text", text: '{"success":true,"data":{"ok":true}}' }],
    });
    const result = normalizeToolResult({
      content: [{ type: "text", text: inner }],
    });
    expect(result).toEqual({
      kind: "json",
      value: { success: true, data: { ok: true } },
    });
  });

  it("treats plain objects without a content envelope as json", () => {
    const result = normalizeToolResult({ ok: true });
    expect(result).toEqual({ kind: "json", value: { ok: true } });
  });

  it("does not parse non-JSON-looking strings", () => {
    const result = normalizeToolResult("123 not json");
    expect(result).toEqual({ kind: "text", text: "123 not json" });
  });

  it("keeps non-text content blocks (e.g. images) as json", () => {
    const result = normalizeToolResult({
      content: [{ type: "image", source: { data: "abc" } }],
    });
    expect(result.kind).toBe("json");
  });

  it("returns empty for an empty-string text result", () => {
    expect(normalizeToolResult("   ").kind).toBe("empty");
  });
});

describe("toDisplayText", () => {
  it("returns text content verbatim", () => {
    expect(toDisplayText({ content: [{ type: "text", text: "abc" }] })).toBe(
      "abc",
    );
  });

  it("pretty-prints structured json", () => {
    expect(toDisplayText({ ok: true })).toBe('{\n  "ok": true\n}');
  });

  it("returns an empty string for empty results", () => {
    expect(toDisplayText(undefined)).toBe("");
  });
});

describe("extractToolResultText", () => {
  it("unwraps a content envelope to its raw text", () => {
    expect(
      extractToolResultText({
        content: [{ type: "text", text: "exec.ts\nfile.ts" }],
      }),
    ).toBe("exec.ts\nfile.ts");
  });

  it("does NOT re-parse JSON-looking stdout", () => {
    const stdout = '{\n  "name": "pkg"\n}';
    expect(
      extractToolResultText({ content: [{ type: "text", text: stdout }] }),
    ).toBe(stdout);
  });

  it("passes plain strings through", () => {
    expect(extractToolResultText("hello")).toBe("hello");
  });

  it("returns an empty string for undefined", () => {
    expect(extractToolResultText(undefined)).toBe("");
  });
});
