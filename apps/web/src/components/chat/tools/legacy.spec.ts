import { describe, expect, it } from "vitest";
import { parseLegacyDetailsBlob } from "./legacy";
import type { SessionChatMessage } from "@/pages/active-session/active-session.utils.types";

function buildMessage(
  overrides: Partial<SessionChatMessage>,
): SessionChatMessage {
  return {
    id: "m1",
    role: "agent",
    content: "read_file started | args: ...",
    category: "tool",
    detailsContent: undefined,
    ...overrides,
  } as SessionChatMessage;
}

describe("parseLegacyDetailsBlob", () => {
  it("returns tool_call with type=tool_call and toolName from content", () => {
    const tc = parseLegacyDetailsBlob(
      buildMessage({
        content: "read_file started | args: x",
        detailsContent: 'Args\n{"path":"x"}',
      }),
    );
    expect(tc.type).toBe("tool_call");
    expect(tc.toolName).toBe("read_file");
    expect(tc.callId).toBe("legacy:m1");
    expect(tc.partialResults).toEqual([]);
    expect(tc.isError).toBe(false);
    expect(tc.status).toBe("finished");
  });
  it("extracts Args section verbatim", () => {
    const tc = parseLegacyDetailsBlob(
      buildMessage({
        detailsContent: 'Args\n{"path":"x.ts"}',
        content: "unknown_tool started",
      }),
    );
    expect(tc.argsObj).toEqual({ path: "x.ts" });
  });
  it("extracts Result section into resultObj", () => {
    const tc = parseLegacyDetailsBlob(
      buildMessage({
        detailsContent: 'Args\n{}\n\nResult\n{"ok":true}',
        content: "tool started",
      }),
    );
    expect(tc.resultObj).toEqual({ ok: true });
    expect(tc.isError).toBe(false);
  });
  it("extracts Error Result section into resultObj and sets isError", () => {
    const tc = parseLegacyDetailsBlob(
      buildMessage({
        content: "tool failed · failed",
        detailsContent: 'Error Result\n{"message":"boom"}',
      }),
    );
    expect(tc.isError).toBe(true);
    expect(tc.resultObj).toEqual({ message: "boom" });
    expect(tc.errorText).toBe("boom");
  });
  it("handles non-JSON args section gracefully as undefined argsObj", () => {
    const tc = parseLegacyDetailsBlob(
      buildMessage({
        detailsContent: "Args\nnot json",
        content: "tool started",
      }),
    );
    expect(tc.argsObj).toBeUndefined();
  });
  it("handles missing detailsContent", () => {
    const tc = parseLegacyDetailsBlob(
      buildMessage({ content: "tool started", detailsContent: undefined }),
    );
    expect(tc.argsObj).toBeUndefined();
    expect(tc.resultObj).toBeUndefined();
    expect(tc.summary).toBe("tool · ✓");
  });
});
