import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  resolveLinkedRunIdFromToolContext,
  resolveProjectIdFromToolContext,
} from "./tool-context-resolvers";

describe("Kanban tool context resolvers", () => {
  it("prefers explicit non-blank project_id and trims it", () => {
    expect(
      resolveProjectIdFromToolContext({
        projectId: " explicit-project ",
        contextScopeId: "context-project",
        toolName: "kanban.example",
      }),
    ).toBe("explicit-project");
  });

  it("falls back to context.scopeId when project_id is omitted", () => {
    expect(
      resolveProjectIdFromToolContext({
        projectId: undefined,
        contextScopeId: " context-project ",
        toolName: "kanban.example",
      }),
    ).toBe("context-project");
  });

  it("falls back to context.scopeId when project_id is blank", () => {
    expect(
      resolveProjectIdFromToolContext({
        projectId: "   ",
        contextScopeId: "context-project",
        toolName: "kanban.example",
      }),
    ).toBe("context-project");
  });

  it("throws BadRequestException when no project context exists", () => {
    expect(() =>
      resolveProjectIdFromToolContext({
        projectId: undefined,
        contextScopeId: null,
        toolName: "kanban.example",
      }),
    ).toThrow(BadRequestException);
  });

  it("prefers explicit linked_run_id and trims it", () => {
    expect(
      resolveLinkedRunIdFromToolContext({
        linkedRunId: " explicit-run ",
        contextWorkflowRunId: "context-run",
      }),
    ).toBe("explicit-run");
  });

  it("falls back to context.workflowRunId for linked_run_id", () => {
    expect(
      resolveLinkedRunIdFromToolContext({
        linkedRunId: undefined,
        contextWorkflowRunId: " context-run ",
      }),
    ).toBe("context-run");
  });

  it("falls back to context.workflowRunId when linked_run_id is blank", () => {
    expect(
      resolveLinkedRunIdFromToolContext({
        linkedRunId: "   ",
        contextWorkflowRunId: " context-run ",
      }),
    ).toBe("context-run");
  });

  it("returns undefined when linked_run_id and workflow run context are absent", () => {
    expect(
      resolveLinkedRunIdFromToolContext({
        linkedRunId: undefined,
        contextWorkflowRunId: undefined,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when linked_run_id and blank workflow run context are absent", () => {
    expect(
      resolveLinkedRunIdFromToolContext({
        linkedRunId: "   ",
        contextWorkflowRunId: "   ",
      }),
    ).toBeUndefined();
  });
});
