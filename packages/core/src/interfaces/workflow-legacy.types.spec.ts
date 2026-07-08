import { describe, expect, it } from "vitest";
import type {
  IMemorySegment,
  IToolPermissionPolicy,
} from "./workflow-legacy.types";
import { WorkflowStatus } from "./workflow-legacy.types";
import { isTerminalWorkflowRunStatus } from "../common/workflow-status.utils";
import { ToolPolicyEffect } from "../tool-policy/tool-policy.types";

describe("isTerminalWorkflowRunStatus", () => {
  it("returns true for COMPLETED, FAILED, CANCELLED", () => {
    expect(isTerminalWorkflowRunStatus(WorkflowStatus.COMPLETED)).toBe(true);
    expect(isTerminalWorkflowRunStatus(WorkflowStatus.FAILED)).toBe(true);
    expect(isTerminalWorkflowRunStatus(WorkflowStatus.CANCELLED)).toBe(true);
  });

  it("returns false for non-terminal statuses", () => {
    expect(isTerminalWorkflowRunStatus(WorkflowStatus.RUNNING)).toBe(false);
    expect(isTerminalWorkflowRunStatus(WorkflowStatus.PENDING)).toBe(false);
  });

  it("returns false for unknown/garbage values", () => {
    expect(isTerminalWorkflowRunStatus("UNKNOWN")).toBe(false);
    expect(isTerminalWorkflowRunStatus(null)).toBe(false);
    expect(isTerminalWorkflowRunStatus(undefined)).toBe(false);
  });
});

describe("IMemorySegment", () => {
  it("allows optional memory segment provenance metadata", () => {
    const segment: IMemorySegment = {
      id: "segment-1",
      entity_type: "User",
      entity_id: "user-1",
      memory_type: "fact",
      content: "Remember this",
      version: 1,
      metadata_json: { source: "chat", source_id: "message-1" },
      created_at: new Date("2026-05-16T00:00:00.000Z"),
      updated_at: new Date("2026-05-16T00:00:00.000Z"),
    };

    expect(segment.metadata_json).toEqual({
      source: "chat",
      source_id: "message-1",
    });
  });
});

describe("IToolPermissionPolicy", () => {
  it("accepts tool_policy as a ToolPolicyDocument", () => {
    const policy: IToolPermissionPolicy = {
      tool_policy: {
        default: ToolPolicyEffect.DENY,
        rules: [{ effect: ToolPolicyEffect.ALLOW, tool: "read" }],
      },
    };
    expect(policy.tool_policy?.default).toBe(ToolPolicyEffect.DENY);
  });
});
