// packages/e2e-tests/src/fake-llm/__tests__/scenario.test.ts
import { describe, expect, it } from "vitest";
import { isText, isToolCall, scenario, text, toolCall } from "../scenario.js";

describe("turn factories + guards", () => {
  it("builds typed turns and narrows them", () => {
    const t = text("hi");
    const c = toolCall("do_thing", { a: 1 });
    expect(isText(t)).toBe(true);
    expect(isToolCall(c)).toBe(true);
    expect(isText(c)).toBe(false);
    expect(c).toEqual({
      kind: "tool_call",
      toolName: "do_thing",
      arguments: { a: 1 },
    });
  });
});

describe("scenario builder", () => {
  it("records rules in declaration order with otherwise last", () => {
    const built = scenario("qa")
      .whenTool("submit_qa_decision")
      .reply(toolCall("submit_qa_decision", { decision: "approve" }))
      .when({ userIncludes: "retry" })
      .reply(text("retrying"))
      .otherwise(text("done"))
      .build();

    expect(built.name).toBe("qa");
    expect(built.rules).toHaveLength(3);
    expect(built.rules[0].match).toEqual({ hasTool: "submit_qa_decision" });
    expect(built.rules[1].match).toEqual({ userIncludes: "retry" });
    expect(built.rules[2].match).toEqual({});
    expect(built.rules[0].respond).toEqual([
      {
        kind: "tool_call",
        toolName: "submit_qa_decision",
        arguments: { decision: "approve" },
      },
    ]);
  });

  it("supports multiple turns in a single reply", () => {
    const built = scenario("multi")
      .when({})
      .reply(text("a"), text("b"))
      .build();
    expect(built.rules[0].respond).toHaveLength(2);
  });
});
