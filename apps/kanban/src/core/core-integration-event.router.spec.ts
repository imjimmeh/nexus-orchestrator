import { describe, expect, it, vi } from "vitest";
import { CoreIntegrationEventRouter } from "./core-integration-event.router";

function build() {
  const prMergedHandler = { handle: vi.fn().mockResolvedValue(undefined) };
  const prStatusHandler = { handle: vi.fn().mockResolvedValue(undefined) };
  const improvementTaskHandler = {
    handle: vi.fn().mockResolvedValue(undefined),
  };
  const router = new CoreIntegrationEventRouter(
    prMergedHandler as never,
    prStatusHandler as never,
    improvementTaskHandler as never,
  );
  return { router, prMergedHandler, prStatusHandler, improvementTaskHandler };
}

function envelope(eventType: string, payload: unknown): string {
  return JSON.stringify({
    event_id: "11111111-1111-1111-1111-111111111111",
    event_type: eventType,
    event_version: "v1",
    occurred_at: "2026-06-22T00:00:00.000Z",
    correlation_id: "22222222-2222-2222-2222-222222222222",
    source_service: "core",
    payload,
    metadata: null,
  });
}

const mergedPayload = {
  scopeId: "project-1",
  contextId: "wi-1",
  prUrl: "https://github.com/acme/widgets/pull/42",
  mergeCommitSha: "sha-merge",
};

const statusPayload = {
  scopeId: "project-1",
  contextId: "wi-1",
  prUrl: "https://github.com/acme/widgets/pull/42",
  checks: "failing",
  reviewDecision: "changes_requested",
};

const improvementTaskPayload = {
  proposalId: "11111111-0000-4000-8000-000000000002",
  title: "Fix NUL-byte handling in outbox insert",
  description: "NUL bytes abort the outbox INSERT.",
  evidence: { runIds: [], failureClasses: [], ledgerRefs: [] },
  severity: "high",
  occurrenceCount: 1,
};

describe("CoreIntegrationEventRouter", () => {
  it("handles the core.integration and improvement task event types", () => {
    const { router } = build();
    expect(router.handles("core.integration.pr_merged.v1")).toBe(true);
    expect(router.handles("core.integration.pr_status.v1")).toBe(true);
    expect(router.handles("improvement.task.requested.v1")).toBe(true);
    expect(router.handles("core.workflow.run.completed.v1")).toBe(false);
    expect(router.handles(undefined)).toBe(false);
  });

  it("dispatches pr_merged to the merged handler", async () => {
    const { router, prMergedHandler, prStatusHandler } = build();
    await router.route(
      "core.integration.pr_merged.v1",
      envelope("core.integration.pr_merged.v1", mergedPayload),
    );
    expect(prMergedHandler.handle).toHaveBeenCalledWith(mergedPayload);
    expect(prStatusHandler.handle).not.toHaveBeenCalled();
  });

  it("dispatches pr_status to the status handler", async () => {
    const { router, prMergedHandler, prStatusHandler } = build();
    await router.route(
      "core.integration.pr_status.v1",
      envelope("core.integration.pr_status.v1", statusPayload),
    );
    expect(prStatusHandler.handle).toHaveBeenCalledWith(statusPayload);
    expect(prMergedHandler.handle).not.toHaveBeenCalled();
  });

  it("throws on a missing envelope", async () => {
    const { router } = build();
    await expect(
      router.route("core.integration.pr_merged.v1", undefined),
    ).rejects.toThrow(/missing envelope/);
  });

  it("dispatches improvement.task.requested.v1 to the improvement task handler", async () => {
    const { router, improvementTaskHandler, prMergedHandler } = build();
    await router.route(
      "improvement.task.requested.v1",
      envelope("improvement.task.requested.v1", improvementTaskPayload),
    );
    expect(improvementTaskHandler.handle).toHaveBeenCalledWith(
      improvementTaskPayload,
    );
    expect(prMergedHandler.handle).not.toHaveBeenCalled();
  });

  it("throws on a missing improvement task envelope so the consumer dead-letters it", async () => {
    const { router } = build();
    await expect(
      router.route("improvement.task.requested.v1", undefined),
    ).rejects.toThrow("Malformed improvement task event: missing envelope");
  });
});
