import { describe, expect, it, vi } from "vitest";
import { CoreLifecycleStreamConsumerService } from "./core-lifecycle-stream.consumer";

interface ConsumerStubs {
  integrationEventRouter: {
    handles: ReturnType<typeof vi.fn>;
    route: ReturnType<typeof vi.fn>;
  };
  cursors: {
    getCursor: ReturnType<typeof vi.fn>;
    saveCursor: ReturnType<typeof vi.fn>;
  };
  deadLetters: {
    saveDeadLetter: ReturnType<typeof vi.fn>;
    countRecent: ReturnType<typeof vi.fn>;
  };
}

function buildConsumerUnderTest(
  stubs: ConsumerStubs,
): CoreLifecycleStreamConsumerService {
  const noop = vi.fn().mockResolvedValue(undefined);
  const redis = { xrange: vi.fn(), xread: vi.fn() };
  const projectionService = { recordCoreLifecycleEvent: noop };
  const orchestrationService = {
    reconcileLinkedWorkflowRun: vi.fn().mockResolvedValue({ cleared: true }),
    findByLinkedWorkflowRun: vi.fn().mockResolvedValue(null),
  };
  const workItems = {
    linkRunIfUnlinked: vi.fn().mockResolvedValue(false),
    addTokenSpend: vi.fn().mockResolvedValue(true),
    addCostSpend: vi.fn().mockResolvedValue(true),
    findByProjectAndId: vi.fn().mockResolvedValue(null),
  };
  const repairLane = { recordFailedWorkItemRun: noop };
  const wakeupService = {
    requestWakeup: vi.fn().mockResolvedValue({ emitted: true }),
  };
  const leaseService = {
    releaseCycleLease: noop,
    heartbeatCycleLease: noop,
  };
  const charterRegen = { enqueue: noop };

  return new CoreLifecycleStreamConsumerService(
    redis as never,
    projectionService as never,
    stubs.cursors as never,
    stubs.deadLetters as never,
    orchestrationService as never,
    workItems as never,
    { recordAttempt: vi.fn().mockResolvedValue({ inserted: true }) } as never,
    repairLane as never,
    wakeupService as never,
    leaseService as never,
    charterRegen as never,
    stubs.integrationEventRouter as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function buildStubs(handledTypes: ReadonlySet<string>): ConsumerStubs {
  return {
    integrationEventRouter: {
      handles: vi.fn((eventType: string) => handledTypes.has(eventType)),
      route: vi.fn().mockResolvedValue(undefined),
    },
    cursors: {
      getCursor: vi.fn().mockResolvedValue(null),
      saveCursor: vi.fn().mockResolvedValue(undefined),
    },
    deadLetters: {
      saveDeadLetter: vi.fn().mockResolvedValue(undefined),
      countRecent: vi.fn().mockResolvedValue(0),
    },
  };
}

function entry(streamId: string, eventType: string, payload: unknown) {
  const envelope = {
    event_id: streamId,
    event_type: eventType,
    event_version: "v1",
    occurred_at: "2026-06-22T00:00:00.000Z",
    correlation_id: streamId,
    source_service: "core",
    payload,
    metadata: null,
  };
  return [
    streamId,
    ["event_type", eventType, "envelope", JSON.stringify(envelope)],
  ] as [string, string[]];
}

describe("CoreLifecycleStreamConsumerService integration-event routing", () => {
  it("delegates a core.integration.pr_merged.v1 entry to the router and advances the cursor", async () => {
    const stubs = buildStubs(new Set(["core.integration.pr_merged.v1"]));
    const consumer = buildConsumerUnderTest(stubs);
    const e = entry("1-0", "core.integration.pr_merged.v1", {
      scopeId: "project-1",
      contextId: "wi-1",
      prUrl: "https://github.com/acme/widgets/pull/42",
      mergeCommitSha: "sha-merge",
    });

    await consumer.processEntriesForTest([e], "test-consumer");

    expect(stubs.integrationEventRouter.route).toHaveBeenCalledWith(
      "core.integration.pr_merged.v1",
      e[1][3],
    );
    expect(stubs.cursors.saveCursor).toHaveBeenCalledWith(
      "test-consumer",
      "1-0",
    );
    expect(stubs.deadLetters.saveDeadLetter).not.toHaveBeenCalled();
  });

  it("delegates a core.integration.pr_status.v1 entry to the router", async () => {
    const stubs = buildStubs(new Set(["core.integration.pr_status.v1"]));
    const consumer = buildConsumerUnderTest(stubs);
    const e = entry("2-0", "core.integration.pr_status.v1", {
      scopeId: "project-1",
      contextId: "wi-1",
      prUrl: "https://github.com/acme/widgets/pull/42",
      checks: "failing",
      reviewDecision: "changes_requested",
    });

    await consumer.processEntriesForTest([e], "test-consumer");

    expect(stubs.integrationEventRouter.route).toHaveBeenCalledWith(
      "core.integration.pr_status.v1",
      e[1][3],
    );
    expect(stubs.cursors.saveCursor).toHaveBeenCalledWith(
      "test-consumer",
      "2-0",
    );
    expect(stubs.deadLetters.saveDeadLetter).not.toHaveBeenCalled();
  });
});
