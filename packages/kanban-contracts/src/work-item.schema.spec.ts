import { describe, it, expect } from "vitest";
import {
  WorkItemEscalationSchema,
  ESCALATION_RECOMMENDATIONS,
  MAX_ESCALATION_REPLAN_ATTEMPTS,
  CreateWorkItemInputSchema,
  WorkItemRecordSchema,
} from "./work-item.schema";

describe("WorkItemEscalationSchema", () => {
  it("parses a fresh_architect_pass escalation with a default replanAttempts of 0", () => {
    const parsed = WorkItemEscalationSchema.parse({
      reason: "repeated_ac_failure",
      escalatedAt: "2026-06-16T09:51:00.000Z",
      recommendation: "fresh_architect_pass",
    });
    expect(parsed.recommendation).toBe("fresh_architect_pass");
    expect(parsed.replanAttempts).toBe(0);
  });

  it("preserves an explicit replanAttempts count", () => {
    const parsed = WorkItemEscalationSchema.parse({
      reason: "repeated_ac_failure",
      escalatedAt: "2026-06-16T09:51:00.000Z",
      recommendation: "fresh_architect_pass",
      replanAttempts: 2,
    });
    expect(parsed.replanAttempts).toBe(2);
  });

  it("rejects an unknown recommendation", () => {
    expect(() =>
      WorkItemEscalationSchema.parse({
        reason: "repeated_ac_failure",
        escalatedAt: "2026-06-16T09:51:00.000Z",
        recommendation: "teleport_to_done",
      }),
    ).toThrow();
  });

  it("exposes the recovery cap as a positive integer", () => {
    expect(ESCALATION_RECOMMENDATIONS).toContain("fresh_architect_pass");
    expect(Number.isInteger(MAX_ESCALATION_REPLAN_ATTEMPTS)).toBe(true);
    expect(MAX_ESCALATION_REPLAN_ATTEMPTS).toBeGreaterThan(0);
  });
});

describe("work item schema with types", () => {
  it("accepts type + storyPoints + parentWorkItemId on create", () => {
    const parsed = CreateWorkItemInputSchema.parse({
      title: "Add login",
      type: "task",
      storyPoints: 3,
      parentWorkItemId: "11111111-1111-1111-1111-111111111111",
    });
    expect(parsed.type).toBe("task");
    expect(parsed.storyPoints).toBe(3);
  });

  it("rejects non-Fibonacci storyPoints", () => {
    expect(
      CreateWorkItemInputSchema.safeParse({ title: "x", storyPoints: 4 })
        .success,
    ).toBe(false);
  });

  it("exposes derived hasChildren + rolledUpPoints on the record", () => {
    const rec = WorkItemRecordSchema.parse({
      id: "a",
      project_id: "p",
      title: "Epic",
      status: "todo",
      type: "epic",
      hasChildren: true,
      rolledUpPoints: 8,
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
      linkedRunId: null,
    });
    expect(rec.hasChildren).toBe(true);
    expect(rec.rolledUpPoints).toBe(8);
  });

  it("no longer accepts scope", () => {
    const parsed = CreateWorkItemInputSchema.safeParse({
      title: "x",
      scope: "large",
    });
    expect(parsed.success).toBe(false); // .strict() rejects unknown key
  });
});
