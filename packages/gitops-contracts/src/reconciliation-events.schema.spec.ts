import { describe, it, expect } from "vitest";
import {
  GitOpsReconciliationDeprecatedApplyEventSchema,
  GitOpsReconciliationTickCompletedEventSchema,
} from "./reconciliation-events.schema";

describe("gitops reconciliation-events schemas", () => {
  it("parses a deprecated_apply event with a bindingId", () => {
    const parsed = GitOpsReconciliationDeprecatedApplyEventSchema.parse({
      bindingId: "binding-1",
      emittedAt: "2026-06-22T10:15:00.000Z",
      reason: "legacy POST /gitops/reconcile adapter call",
    });
    expect(parsed.bindingId).toBe("binding-1");
    expect(parsed.reason).toBe("legacy POST /gitops/reconcile adapter call");
  });

  it("parses a deprecated_apply event with a null bindingId", () => {
    const parsed = GitOpsReconciliationDeprecatedApplyEventSchema.parse({
      bindingId: null,
      emittedAt: "2026-06-22T10:15:00.000Z",
      reason: "env-driven legacy adapter",
    });
    expect(parsed.bindingId).toBeNull();
  });

  it("rejects an empty reason on deprecated_apply", () => {
    const result = GitOpsReconciliationDeprecatedApplyEventSchema.safeParse({
      bindingId: "binding-1",
      emittedAt: "2026-06-22T10:15:00.000Z",
      reason: "",
    });
    expect(result.success).toBe(false);
  });

  it("parses a tick_completed event", () => {
    const parsed = GitOpsReconciliationTickCompletedEventSchema.parse({
      applied: 2,
      conflicts: 1,
      errors: 0,
      bindingsEvaluated: 3,
      emittedAt: "2026-06-22T10:15:00.000Z",
      durationMs: 42,
    });
    expect(parsed.applied).toBe(2);
    expect(parsed.conflicts).toBe(1);
    expect(parsed.errors).toBe(0);
    expect(parsed.bindingsEvaluated).toBe(3);
  });

  it("rejects negative counts on tick_completed", () => {
    const result = GitOpsReconciliationTickCompletedEventSchema.safeParse({
      applied: -1,
      conflicts: 0,
      errors: 0,
      bindingsEvaluated: 1,
      emittedAt: "2026-06-22T10:15:00.000Z",
      durationMs: 1,
    });
    expect(result.success).toBe(false);
  });
});
