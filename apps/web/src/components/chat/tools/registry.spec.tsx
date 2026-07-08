import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolCallRenderer } from "./ToolCallRenderer";
import {
  registerExactTool,
  registerPatternTool,
  registerToolRenderable,
  resetToolRegistry,
  resolveTool,
} from "./registry";
import type { ToolCallMetadata } from "../chat.types";
import type { ToolProps } from "./registry";
import { GenericTool } from "./GenericTool";
import { ReadFileTool } from "./ReadFileTool";
import { WriteFileTool } from "./WriteFileTool";
import { EditFileTool } from "./EditFileTool";
import { BashTool } from "./BashTool";
import { CommandResultTool } from "./CommandResultTool";
import { KanbanTool } from "./KanbanTool";

function buildToolCall(
  toolName: string,
  overrides: Partial<ToolCallMetadata> = {},
): ToolCallMetadata {
  return {
    type: "tool_call",
    toolName,
    callId: "c1",
    status: "finished",
    summary: `${toolName} · ✓`,
    partialResults: [],
    isError: false,
    startedAt: 1000,
    ...overrides,
  };
}

describe("ToolCallRenderer / registry", () => {
  afterEach(() => resetToolRegistry());

  it("resolves unknown tool names to GenericTool", () => {
    const Comp = resolveTool("totally_unknown_tool");
    expect(Comp).toBe(GenericTool);
  });
  it("renders generic fallback for unknown tool", () => {
    render(
      <ToolCallRenderer toolCall={buildToolCall("totally_unknown_tool")} />,
    );
    expect(screen.getByText("totally_unknown_tool")).toBeTruthy();
  });
  it("supports dynamic registration via registerToolRenderable", () => {
    function Custom({ toolCall }: Readonly<ToolProps>) {
      return <div data-testid="custom">{toolCall.toolName}-custom</div>;
    }
    registerToolRenderable("__test_custom__", Custom);
    const Comp = resolveTool("__test_custom__");
    expect(Comp).toBe(Custom);
  });
  it("supports exact registration via registerExactTool", () => {
    function ExactComp({ toolCall }: Readonly<ToolProps>) {
      return <div>{toolCall.toolName}-exact</div>;
    }
    registerExactTool("exact_tool", ExactComp);
    const Comp = resolveTool("exact_tool");
    expect(Comp).toBe(ExactComp);
  });
  it("supports pattern registration via registerPatternTool", () => {
    function PatternComp({ toolCall }: Readonly<ToolProps>) {
      return <div>{toolCall.toolName}-pattern</div>;
    }
    registerPatternTool((name) => name.startsWith("mcp_"), PatternComp);
    const Comp = resolveTool("mcp__anything");
    expect(Comp).toBe(PatternComp);
  });
  it("resolves harness file-tool aliases case-insensitively", () => {
    registerExactTool("read_file", ReadFileTool);
    registerExactTool("write_file", WriteFileTool);
    registerExactTool("edit_file", EditFileTool);
    registerExactTool("bash", BashTool);
    expect(resolveTool("read")).toBe(ReadFileTool);
    expect(resolveTool("Read")).toBe(ReadFileTool);
    expect(resolveTool("write")).toBe(WriteFileTool);
    expect(resolveTool("edit")).toBe(EditFileTool);
    expect(resolveTool("Bash")).toBe(BashTool);
  });
  it("routes listing/search tools to CommandResultTool", () => {
    registerExactTool("ls", CommandResultTool);
    registerExactTool("grep", CommandResultTool);
    expect(resolveTool("ls")).toBe(CommandResultTool);
    expect(resolveTool("grep")).toBe(CommandResultTool);
  });
  it("routes kanban.* to KanbanTool via pattern", () => {
    registerPatternTool((n) => n.startsWith("kanban."), KanbanTool);
    expect(resolveTool("kanban.project_state")).toBe(KanbanTool);
  });
  it("respects precedence: dynamic > exact > pattern > fallback", () => {
    function DynamicComp({ toolCall }: Readonly<ToolProps>) {
      return <div>{toolCall.toolName}-dynamic</div>;
    }
    function ExactComp({ toolCall }: Readonly<ToolProps>) {
      return <div>{toolCall.toolName}-exact</div>;
    }
    registerToolRenderable("__precedence__", DynamicComp);
    registerExactTool("__precedence__", ExactComp);
    const Comp = resolveTool("__precedence__");
    expect(Comp).toBe(DynamicComp);
  });
});
