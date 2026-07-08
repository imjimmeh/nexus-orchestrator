// packages/e2e-tests/src/fake-llm/__tests__/matcher.test.ts
import { describe, expect, it } from "vitest";
import { matchesRule, selectResponse } from "../matcher.js";
import type { CanonicalRequest, Scenario } from "../types.js";

function req(overrides: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    protocol: "openai",
    model: "gpt-test",
    system: "You are a helpful assistant.",
    messages: [{ role: "user", text: "please summarize" }],
    tools: [{ name: "submit_qa_decision", description: "" }],
    stream: false,
    rawBody: {},
    headers: {},
    ...overrides,
  };
}

describe("matchesRule", () => {
  it("returns true when every provided predicate holds", () => {
    expect(
      matchesRule(
        {
          model: /gpt/,
          systemIncludes: "helpful",
          userIncludes: "summarize",
          hasTool: "submit_qa_decision",
        },
        req(),
        0,
      ),
    ).toBe(true);
  });

  it("returns false when any predicate fails", () => {
    expect(matchesRule({ userIncludes: "translate" }, req(), 0)).toBe(false);
    expect(matchesRule({ model: "other" }, req(), 0)).toBe(false);
    expect(matchesRule({ hasTool: "missing_tool" }, req(), 0)).toBe(false);
  });

  it("matches callIndex against the supplied index", () => {
    expect(matchesRule({ callIndex: 2 }, req(), 2)).toBe(true);
    expect(matchesRule({ callIndex: 2 }, req(), 1)).toBe(false);
  });

  it("matches toolResultFor against tool-result messages", () => {
    const withResult = req({
      messages: [
        { role: "tool", text: '{"ok":true}', toolName: "submit_qa_decision" },
      ],
    });
    expect(
      matchesRule({ toolResultFor: "submit_qa_decision" }, withResult, 0),
    ).toBe(true);
    expect(matchesRule({ toolResultFor: "other" }, withResult, 0)).toBe(false);
  });

  it("an empty match object matches anything", () => {
    expect(matchesRule({}, req(), 5)).toBe(true);
  });
});

describe("selectResponse", () => {
  const scenario: Scenario = {
    name: "s",
    rules: [
      {
        match: { userIncludes: "translate" },
        respond: [{ kind: "text", text: "translation" }],
      },
      {
        match: { hasTool: "submit_qa_decision" },
        respond: [
          {
            kind: "tool_call",
            toolName: "submit_qa_decision",
            arguments: { decision: "approve" },
          },
        ],
      },
      { match: {}, respond: [{ kind: "text", text: "fallback" }] },
    ],
  };

  it("returns the first matching rule response", () => {
    expect(selectResponse(scenario, req(), 0)).toEqual([
      {
        kind: "tool_call",
        toolName: "submit_qa_decision",
        arguments: { decision: "approve" },
      },
    ]);
  });

  it("falls through to the catch-all rule", () => {
    expect(selectResponse(scenario, req({ tools: [] }), 0)).toEqual([
      { kind: "text", text: "fallback" },
    ]);
  });

  it("returns null when no rule matches", () => {
    expect(selectResponse({ name: "s", rules: [] }, req(), 0)).toBeNull();
  });
});
