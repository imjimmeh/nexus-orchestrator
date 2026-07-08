import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FailureClass } from "@nexus/core";
import { getKanbanEventEmitter } from "../events/kanban-event-emitter";
import type { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import {
  KANBAN_RETROSPECTIVE_FAILURE_OBSERVED_EVENT,
  KanbanRetrospectiveFailureThresholdService,
} from "./kanban-retrospective-failure-threshold.service";
import {
  computeWindowStartEpochSeconds,
  FAILURE_TIMESTAMPS_METADATA_KEY,
  LAST_EMITTED_AT_METADATA_KEY,
  LAST_EMITTED_WINDOW_METADATA_KEY,
  isCooldownActive,
  pruneAndAppendFailureTimestamp,
} from "./kanban-retrospective-failure-threshold.helpers";
import type { ISystemSettingsReader } from "./kanban-retrospective-failure-threshold.types";
import type { KanbanRetrospectiveService } from "./kanban-retrospective.service";

// The default sliding-window length is 600s and the default system time in
// beforeEach is `2026-05-16T12:00:00.000Z` (= epoch seconds 1778932800),
// so the deterministic window-start epoch seconds is
// Math.floor((1778932800 - 600) / 60) * 60 = 1778932200.
const DEFAULT_SYSTEM_TIME_EPOCH_SECONDS = 1778932800;
const DEFAULT_WINDOW_START_EPOCH_SECONDS = 1778932200;

type MockKanbanOrchestrationRepository = {
  findByproject_id: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
};

type MockKanbanRetrospectiveService = {
  runForFailureThreshold: ReturnType<typeof vi.fn>;
};

type MockSystemSettingsReader = {
  get: ReturnType<typeof vi.fn>;
};

type FailureObservedPayload = {
  event_name: string;
  scope_id: string;
  failure_class: string | null;
  counted: boolean;
  observation_reason: string;
  consecutive_failure_count: number;
  threshold?: number;
  observed_at: string;
};

describe("KanbanRetrospectiveFailureThresholdService", () => {
  let orchestrations: MockKanbanOrchestrationRepository;
  let retrospectives: MockKanbanRetrospectiveService;
  let systemSettings: MockSystemSettingsReader;
  let service: KanbanRetrospectiveFailureThresholdService;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T12:00:00.000Z"));

    orchestrations = {
      findByproject_id: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };
    retrospectives = {
      runForFailureThreshold: vi.fn().mockResolvedValue({
        status: "completed",
        runId: "retrospective-run-1",
        candidateCount: 1,
      }),
    };
    // SystemSettings reader is constructed per-test (always responds
    // with `undefined` so the service falls through to the env-var /
    // hardcoded defaults unless the test overrides individual keys).
    systemSettings = {
      get: vi.fn().mockImplementation((_key, defaultValue) =>
        Promise.resolve(defaultValue),
      ),
    };
    service = new KanbanRetrospectiveFailureThresholdService(
      orchestrations as unknown as KanbanOrchestrationRepository,
      retrospectives as unknown as KanbanRetrospectiveService,
      systemSettings as unknown as ISystemSettingsReader,
    );
    // Spy on the in-process event emitter so tests can assert which
    // `kanban.retrospective.failure_observed` payloads were emitted.
    emitSpy = vi
      .spyOn(getKanbanEventEmitter(), "emit")
      .mockReturnValue(true);
  });

  afterEach(() => {
    emitSpy.mockRestore();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // checkFailureThreshold
  // ---------------------------------------------------------------------------

  describe("checkFailureThreshold", () => {
    it("does nothing when no orchestration exists for the project", async () => {
      orchestrations.findByproject_id.mockResolvedValue(null);

      await service.checkFailureThreshold("project-1");

      expect(orchestrations.findByproject_id).toHaveBeenCalledWith("project-1");
      expect(orchestrations.save).not.toHaveBeenCalled();
      expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();
    });

    it("skips the trigger when the new count is below the configured threshold", async () => {
      setOrchestrationMetadata({});

      await service.checkFailureThreshold("project-1");

      expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();
    });

    it("persists the incremented counter on every call (single point of mutation)", async () => {
      setOrchestrationMetadata({});

      await service.checkFailureThreshold("project-1");

      expect(orchestrations.save).toHaveBeenCalledTimes(1);
      const savedArg = orchestrations.save.mock.calls[0][0];
      expect(savedArg.metadata).toEqual({
        consecutive_failure_count: 1,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [DEFAULT_SYSTEM_TIME_EPOCH_SECONDS],
      });
    });

    it("starts from 1 when no previous consecutive_failure_count exists", async () => {
      setOrchestrationMetadata({});

      await service.checkFailureThreshold("project-1");

      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: "project-1",
          metadata: {
            consecutive_failure_count: 1,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [DEFAULT_SYSTEM_TIME_EPOCH_SECONDS],
          },
        }),
      );
    });

    it("increments an existing consecutive_failure_count", async () => {
      // Seed the prior in-window timestamps so the post-prune list still
      // reflects 3 entries (one of which is `now`). The previous-count
      // bookkeeping is independent of the in-window count under the
      // M2 contract, but consecutive_failure_count is still incremented
      // for downstream observability.
      setOrchestrationMetadata({
        consecutive_failure_count: 2,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      });

      await service.checkFailureThreshold("project-1");

      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: "project-1",
          metadata: expect.objectContaining({
            consecutive_failure_count: 3,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
            ],
          }),
        }),
      );
    });

    it("handles null metadata on the orchestration and starts at 1", async () => {
      setOrchestrationMetadata(null);

      await service.checkFailureThreshold("project-1");

      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            consecutive_failure_count: 1,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [DEFAULT_SYSTEM_TIME_EPOCH_SECONDS],
          },
        }),
      );
    });

    it("does not modify other metadata keys when incrementing the counter", async () => {
      setOrchestrationMetadata({
        consecutive_failure_count: 1,
        last_dead_letter_id: "dl-abc",
        custom_field: 42,
      });

      await service.checkFailureThreshold("project-1");

      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            consecutive_failure_count: 2,
            last_dead_letter_id: "dl-abc",
            custom_field: 42,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [DEFAULT_SYSTEM_TIME_EPOCH_SECONDS],
          },
        }),
      );
    });

    it("fires the retrospective when the in-window count hits the default threshold of 3", async () => {
      // Seed two timestamps within the 600s sliding window so the
      // post-prune list reaches 3 entries after the new call. The
      // post-prune count (3) is what trips the threshold; the
      // consecutive_failure_count value is incidental bookkeeping.
      setOrchestrationMetadata({
        consecutive_failure_count: 2,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      });

      await service.checkFailureThreshold("project-1");

      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith({
        projectId: "project-1",
        triggerRevisionMarker: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
        idempotencyKey: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
      });
    });

    it("fires the retrospective when the in-window count exceeds the threshold", async () => {
      // Seed 5 timestamps within the window so the post-prune list
      // reaches 6 entries after the new call.
      const priorTimestamps = [
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 50,
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 40,
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
      ];
      setOrchestrationMetadata({
        consecutive_failure_count: 5,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: priorTimestamps,
      });

      await service.checkFailureThreshold("project-1");

      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith({
        projectId: "project-1",
        triggerRevisionMarker: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
        idempotencyKey: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
      });
    });

    it("builds the idempotency key from the deterministic triggerRevisionMarker", async () => {
      const priorTimestamps = [
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 50,
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 40,
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
      ];
      setOrchestrationMetadata({
        consecutive_failure_count: 6,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: priorTimestamps,
      });

      await service.checkFailureThreshold("project-abc");

      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerRevisionMarker: `failure-threshold:project-abc:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
          idempotencyKey: `failure-threshold:project-abc:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
        }),
      );
    });

    it("respects a custom FAILURE_THRESHOLD_COUNT env var", async () => {
      process.env.FAILURE_THRESHOLD_COUNT = "5";
      try {
        // Construct a fresh service so resolveSettings() re-reads the env.
        service = new KanbanRetrospectiveFailureThresholdService(
          orchestrations as unknown as KanbanOrchestrationRepository,
          retrospectives as unknown as KanbanRetrospectiveService,
          systemSettings as unknown as ISystemSettingsReader,
        );
        // First call: windowCount=1, below custom 5
        setOrchestrationMetadata({});
        await service.checkFailureThreshold("project-1");
        expect(orchestrations.save).toHaveBeenLastCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              consecutive_failure_count: 1,
            }),
          }),
        );
        expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();

        // Second call: windowCount=2, below custom 5
        setOrchestrationMetadata({
          consecutive_failure_count: 1,
          [FAILURE_TIMESTAMPS_METADATA_KEY]: [
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
          ],
        });
        await service.checkFailureThreshold("project-1");
        expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();

        // Third call: windowCount=3, below custom 5
        setOrchestrationMetadata({
          consecutive_failure_count: 2,
          [FAILURE_TIMESTAMPS_METADATA_KEY]: [
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
          ],
        });
        await service.checkFailureThreshold("project-1");
        expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();

        // Fourth call: windowCount=4, below custom 5
        setOrchestrationMetadata({
          consecutive_failure_count: 3,
          [FAILURE_TIMESTAMPS_METADATA_KEY]: [
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
          ],
        });
        await service.checkFailureThreshold("project-1");
        expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();

        // Fifth call: windowCount=5 (custom threshold), fires
        setOrchestrationMetadata({
          consecutive_failure_count: 4,
          [FAILURE_TIMESTAMPS_METADATA_KEY]: [
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 40,
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
          ],
        });
        await service.checkFailureThreshold("project-1");
        expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith(
          expect.objectContaining({
            idempotencyKey: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
          }),
        );
      } finally {
        delete process.env.FAILURE_THRESHOLD_COUNT;
      }
    });

    it("ignores non-numeric FAILURE_THRESHOLD_COUNT and falls back to 3", async () => {
      process.env.FAILURE_THRESHOLD_COUNT = "not-a-number";
      try {
        // Construct a fresh service so resolveSettings() re-reads the env.
        service = new KanbanRetrospectiveFailureThresholdService(
          orchestrations as unknown as KanbanOrchestrationRepository,
          retrospectives as unknown as KanbanRetrospectiveService,
          systemSettings as unknown as ISystemSettingsReader,
        );
        // First call: windowCount=1, below fallback 3
        setOrchestrationMetadata({});
        await service.checkFailureThreshold("project-1");
        expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();

        // Second call: windowCount=2, below fallback 3
        setOrchestrationMetadata({
          consecutive_failure_count: 1,
          [FAILURE_TIMESTAMPS_METADATA_KEY]: [
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
          ],
        });
        await service.checkFailureThreshold("project-1");
        expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();

        // Third call: windowCount=3 (fallback threshold), fires
        setOrchestrationMetadata({
          consecutive_failure_count: 2,
          [FAILURE_TIMESTAMPS_METADATA_KEY]: [
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
            DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
          ],
        });
        await service.checkFailureThreshold("project-1");
        expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith(
          expect.objectContaining({
            idempotencyKey: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
          }),
        );
      } finally {
        delete process.env.FAILURE_THRESHOLD_COUNT;
      }
    });

    it("bails out without firing when the orchestration save throws", async () => {
      setOrchestrationMetadata({});
      orchestrations.save.mockRejectedValue(new Error("DB write failure"));

      await service.checkFailureThreshold("project-1");

      expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // checkFailureThreshold — FailureClass semantics (WI-2026-062)
  // ---------------------------------------------------------------------------

  describe("checkFailureThreshold with FailureClass discriminator", () => {
    /**
     * Helper: extract every `failure_observed` payload the service
     * emitted during the test. Filters out unrelated event names so a
     * test that asserts `expectNoObservation` is not confused by
     * noise from neighbouring tests (each test gets a fresh
     * `beforeEach` but the global emitter persists across tests).
     */
    function getObservations(): FailureObservedPayload[] {
      return emitSpy.mock.calls
        .filter(
          (call) => call[0] === KANBAN_RETROSPECTIVE_FAILURE_OBSERVED_EVENT,
        )
        .map(
          (call) => (call[1] ?? null) as FailureObservedPayload | null,
        )
        .filter((payload): payload is FailureObservedPayload => payload !== null);
    }

    it("increments the counter and fires the retrospective for SystemFailure", async () => {
      setOrchestrationMetadata({
        consecutive_failure_count: 2,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      });

      await service.checkFailureThreshold(
        "project-1",
        FailureClass.SystemFailure,
      );

      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: "project-1",
          metadata: expect.objectContaining({
            consecutive_failure_count: 3,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
            ],
          }),
        }),
      );
      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith({
        projectId: "project-1",
        triggerRevisionMarker: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
        idempotencyKey: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
      });

      const observations = getObservations();
      expect(observations).toHaveLength(1);
      expect(observations[0]).toEqual(
        expect.objectContaining({
          event_name: KANBAN_RETROSPECTIVE_FAILURE_OBSERVED_EVENT,
          scope_id: "project-1",
          failure_class: FailureClass.SystemFailure,
          counted: true,
          observation_reason: "counted",
          consecutive_failure_count: 3,
          threshold: 3,
        }),
      );
    });

    it("increments the counter and fires the retrospective for EventDeliveryFailure", async () => {
      setOrchestrationMetadata({
        consecutive_failure_count: 2,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      });

      await service.checkFailureThreshold(
        "project-1",
        FailureClass.EventDeliveryFailure,
      );

      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            consecutive_failure_count: 3,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
            ],
          }),
        }),
      );
      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith({
        projectId: "project-1",
        triggerRevisionMarker: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
        idempotencyKey: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
      });

      const observations = getObservations();
      expect(observations).toHaveLength(1);
      expect(observations[0]).toEqual(
        expect.objectContaining({
          failure_class: FailureClass.EventDeliveryFailure,
          counted: true,
          observation_reason: "counted",
          consecutive_failure_count: 3,
          threshold: 3,
        }),
      );
    });

    it("increments the counter and fires the retrospective for UnhandledException", async () => {
      setOrchestrationMetadata({
        consecutive_failure_count: 2,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      });

      await service.checkFailureThreshold(
        "project-1",
        FailureClass.UnhandledException,
      );

      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            consecutive_failure_count: 3,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
            ],
          }),
        }),
      );
      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith({
        projectId: "project-1",
        triggerRevisionMarker: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
        idempotencyKey: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
      });

      const observations = getObservations();
      expect(observations).toHaveLength(1);
      expect(observations[0]).toEqual(
        expect.objectContaining({
          failure_class: FailureClass.UnhandledException,
          counted: true,
          observation_reason: "counted",
          consecutive_failure_count: 3,
          threshold: 3,
        }),
      );
    });

    it("does not increment for QaRejection but emits the diagnostic event with counted=false", async () => {
      setOrchestrationMetadata({ consecutive_failure_count: 5 });

      await service.checkFailureThreshold(
        "project-1",
        FailureClass.QaRejection,
      );

      // Counter must NOT change.
      expect(orchestrations.save).not.toHaveBeenCalled();
      // Retrospective must NOT fire.
      expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();

      const observations = getObservations();
      expect(observations).toHaveLength(1);
      expect(observations[0]).toEqual(
        expect.objectContaining({
          event_name: KANBAN_RETROSPECTIVE_FAILURE_OBSERVED_EVENT,
          scope_id: "project-1",
          failure_class: FailureClass.QaRejection,
          counted: false,
          observation_reason: "intentional_class",
          consecutive_failure_count: 5,
        }),
      );
      // No threshold field on the non-counted observation.
      expect(observations[0].threshold).toBeUndefined();
    });

    it("does not increment for NoActionableWork but emits the diagnostic event with counted=false", async () => {
      setOrchestrationMetadata({ consecutive_failure_count: 7 });

      await service.checkFailureThreshold(
        "project-1",
        FailureClass.NoActionableWork,
      );

      expect(orchestrations.save).not.toHaveBeenCalled();
      expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();

      const observations = getObservations();
      expect(observations).toHaveLength(1);
      expect(observations[0]).toEqual(
        expect.objectContaining({
          event_name: KANBAN_RETROSPECTIVE_FAILURE_OBSERVED_EVENT,
          scope_id: "project-1",
          failure_class: FailureClass.NoActionableWork,
          counted: false,
          observation_reason: "intentional_class",
          consecutive_failure_count: 7,
        }),
      );
      expect(observations[0].threshold).toBeUndefined();
    });

    it("treats undefined failureClass as counted (back-compat alias for 'not classified') per the shouldCountFailure contract", async () => {
      // The package-level contract documents that `undefined` is a
      // back-compat alias for "unknown / not classified" and is
      // conservatively counted (returns `true`). The current service
      // therefore increments + emits `counted: true` with
      // `failure_class: null` when no class is supplied — this test
      // pins that behaviour so future refactors do not silently flip
      // it.
      setOrchestrationMetadata({
        consecutive_failure_count: 1,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [DEFAULT_SYSTEM_TIME_EPOCH_SECONDS],
      });

      await service.checkFailureThreshold("project-1");

      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            consecutive_failure_count: 2,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
            ],
          },
        }),
      );
      expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();

      const observations = getObservations();
      expect(observations).toHaveLength(1);
      expect(observations[0]).toEqual(
        expect.objectContaining({
          failure_class: null,
          counted: true,
          observation_reason: "counted",
          consecutive_failure_count: 2,
          threshold: 3,
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // resetConsecutiveFailureCount
  // ---------------------------------------------------------------------------

  describe("resetConsecutiveFailureCount", () => {
    it("is a no-op when no orchestration exists for the project", async () => {
      orchestrations.findByproject_id.mockResolvedValue(null);

      await service.resetConsecutiveFailureCount("project-1");

      expect(orchestrations.findByproject_id).toHaveBeenCalledWith("project-1");
      expect(orchestrations.save).not.toHaveBeenCalled();
    });

    it("is a no-op when the counter is already 0", async () => {
      setOrchestrationMetadata({ consecutive_failure_count: 0 });

      await service.resetConsecutiveFailureCount("project-1");

      expect(orchestrations.save).not.toHaveBeenCalled();
    });

    it("resets a non-zero counter back to 0 and clears the failure-window bookkeeping keys", async () => {
      setOrchestrationMetadata({
        consecutive_failure_count: 4,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
        ],
        [LAST_EMITTED_WINDOW_METADATA_KEY]: `project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
        [LAST_EMITTED_AT_METADATA_KEY]: DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
      });

      await service.resetConsecutiveFailureCount("project-1");

      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: "project-1",
          metadata: {
            consecutive_failure_count: 0,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: undefined,
            [LAST_EMITTED_WINDOW_METADATA_KEY]: undefined,
            [LAST_EMITTED_AT_METADATA_KEY]: undefined,
          },
        }),
      );
    });

    it("preserves other metadata keys when resetting", async () => {
      setOrchestrationMetadata({
        consecutive_failure_count: 2,
        last_dead_letter_id: "dl-abc",
        custom_field: 42,
      });

      await service.resetConsecutiveFailureCount("project-1");

      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            consecutive_failure_count: 0,
            last_dead_letter_id: "dl-abc",
            custom_field: 42,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: undefined,
            [LAST_EMITTED_WINDOW_METADATA_KEY]: undefined,
            [LAST_EMITTED_AT_METADATA_KEY]: undefined,
          },
        }),
      );
    });

    it("does not throw when the orchestration save fails", async () => {
      setOrchestrationMetadata({ consecutive_failure_count: 3 });
      orchestrations.save.mockRejectedValue(new Error("DB write failure"));

      await expect(
        service.resetConsecutiveFailureCount("project-1"),
      ).resolves.toBeUndefined();
    });
  });

  /**
   * Configure the orchestration repository mock to return a Kanban-shaped
   * orchestration record for the duration of a single test. The returned
   * object's `metadata` field reflects whatever is provided so the
   * counter logic can operate on a stable shape.
   */
  function setOrchestrationMetadata(
    metadata: Record<string, unknown> | null,
  ): void {
    orchestrations.findByproject_id.mockResolvedValue({
      project_id: "project-1",
      goals: "test goals",
      mode: "autonomous",
      status: "running",
      linked_run_id: "run-1",
      decision_log: null,
      action_requests: null,
      metadata,
      created_at: new Date("2026-05-16T12:00:00.000Z"),
      updated_at: new Date("2026-05-16T12:00:00.000Z"),
    });
  }

  // ---------------------------------------------------------------------------
  // New M2 contract behaviours (WI-2026-063).
  //
  // These tests pin the new shape introduced by OPEN_QUESTIONS K2 + K4 + K5:
  // the systemSettings-driven resolution chain, the sliding/fixed window
  // strategies, the cooldown-bypass knob, and the deterministic trigger
  // revision marker.
  // ---------------------------------------------------------------------------

  /**
   * Builds a `ISystemSettingsReader` mock whose `.get(key, defaultValue)`
   * resolves to the entry from `overrides` when the key is present, or
   * `defaultValue` otherwise. Mirrors the production
   * SystemSettingsService behaviour so we can exercise the new
   * `resolveSettings()` precedence chain in isolation.
   */
  function buildSystemSettingsReader(
    overrides: Record<string, unknown> = {},
  ): MockSystemSettingsReader {
    return {
      get: vi.fn().mockImplementation((key: string, defaultValue: unknown) =>
        Object.prototype.hasOwnProperty.call(overrides, key)
          ? Promise.resolve(overrides[key])
          : Promise.resolve(defaultValue),
      ),
    };
  }

  describe("settings resolution via ISystemSettingsReader", () => {
    it("is a no-op when Enabled=false (no orchestrations.save + no runForFailureThreshold)", async () => {
      const settings = buildSystemSettingsReader({
        retrospective_failure_threshold_enabled: false,
      });
      service = new KanbanRetrospectiveFailureThresholdService(
        orchestrations as unknown as KanbanOrchestrationRepository,
        retrospectives as unknown as KanbanRetrospectiveService,
        settings as unknown as ISystemSettingsReader,
      );
      setOrchestrationMetadata({});

      await service.checkFailureThreshold("project-1");

      expect(orchestrations.save).not.toHaveBeenCalled();
      expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();
    });

    it("reads the Count setting from the system-settings reader", async () => {
      const settings = buildSystemSettingsReader({
        retrospective_failure_threshold_count: 7,
      });
      service = new KanbanRetrospectiveFailureThresholdService(
        orchestrations as unknown as KanbanOrchestrationRepository,
        retrospectives as unknown as KanbanRetrospectiveService,
        settings as unknown as ISystemSettingsReader,
      );
      // Seed 6 in-window timestamps; after the new call the post-prune
      // count reaches 7 (= custom Count setting).
      const priorTimestamps = Array.from({ length: 6 }, (_, i) =>
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - (60 - i * 5),
      );
      setOrchestrationMetadata({
        consecutive_failure_count: 6,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: priorTimestamps,
      });

      await service.checkFailureThreshold("project-1");

      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
        }),
      );
    });

    it("falls back to the FAILURE_THRESHOLD_COUNT env var when the system-settings reader is absent and the env is set", async () => {
      process.env.FAILURE_THRESHOLD_COUNT = "7";
      try {
        // Construct the service WITHOUT a settings reader so
        // resolveSettings() uses the env-var fallback chain.
        service = new KanbanRetrospectiveFailureThresholdService(
          orchestrations as unknown as KanbanOrchestrationRepository,
          retrospectives as unknown as KanbanRetrospectiveService,
        );
        // Seed 6 in-window timestamps; after the new call the post-prune
        // count reaches 7 (= custom env-var fallback).
        const priorTimestamps = Array.from({ length: 6 }, (_, i) =>
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - (60 - i * 5),
        );
        setOrchestrationMetadata({
          consecutive_failure_count: 6,
          [FAILURE_TIMESTAMPS_METADATA_KEY]: priorTimestamps,
        });

        await service.checkFailureThreshold("project-1");

        expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith(
          expect.objectContaining({
            idempotencyKey: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
          }),
        );
      } finally {
        delete process.env.FAILURE_THRESHOLD_COUNT;
      }
    });

    it("does not fire on the 6th failure when the Count setting is 7 (env-var fallback path)", async () => {
      process.env.FAILURE_THRESHOLD_COUNT = "7";
      try {
        service = new KanbanRetrospectiveFailureThresholdService(
          orchestrations as unknown as KanbanOrchestrationRepository,
          retrospectives as unknown as KanbanRetrospectiveService,
        );
        const priorTimestamps = Array.from({ length: 5 }, (_, i) =>
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - (50 - i * 5),
        );
        setOrchestrationMetadata({
          consecutive_failure_count: 5,
          [FAILURE_TIMESTAMPS_METADATA_KEY]: priorTimestamps,
        });

        await service.checkFailureThreshold("project-1");

        expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();
      } finally {
        delete process.env.FAILURE_THRESHOLD_COUNT;
      }
    });
  });

  describe("sliding window strategy", () => {
    it("prunes timestamps older than WindowSeconds (60s sliding)", async () => {
      const settings = buildSystemSettingsReader({
        retrospective_failure_threshold_window_seconds: 60,
      });
      service = new KanbanRetrospectiveFailureThresholdService(
        orchestrations as unknown as KanbanOrchestrationRepository,
        retrospectives as unknown as KanbanRetrospectiveService,
        settings as unknown as ISystemSettingsReader,
      );
      setOrchestrationMetadata({
        consecutive_failure_count: 3,
        // One timestamp older than the 60s window, two within it.
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 90,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      });

      await service.checkFailureThreshold("project-1");

      // After pruning the `-90` entry and appending `now`, only the
      // two recent entries plus `now` remain. With default count of 3,
      // the in-window count is 3 = threshold so the trigger fires.
      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
            ],
          }),
        }),
      );
      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledTimes(1);
    });

    it("does NOT prune timestamps when only 2 are within WindowSeconds (below threshold)", async () => {
      const settings = buildSystemSettingsReader({
        retrospective_failure_threshold_window_seconds: 60,
      });
      service = new KanbanRetrospectiveFailureThresholdService(
        orchestrations as unknown as KanbanOrchestrationRepository,
        retrospectives as unknown as KanbanRetrospectiveService,
        settings as unknown as ISystemSettingsReader,
      );
      setOrchestrationMetadata({
        consecutive_failure_count: 3,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 90,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      });

      await service.checkFailureThreshold("project-1");

      // After pruning + append, the post-prune list has 3 entries
      // (in-window count = 3) so the default threshold is met and the
      // trigger fires. This pins the behaviour of pruneAndAppend when
      // only 2 of the 3 seeded entries survive.
      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledTimes(1);
    });

    it("does not fire when the post-prune in-window count is below the threshold (2 of 3 within window)", async () => {
      const settings = buildSystemSettingsReader({
        retrospective_failure_threshold_window_seconds: 60,
        retrospective_failure_threshold_count: 4,
      });
      service = new KanbanRetrospectiveFailureThresholdService(
        orchestrations as unknown as KanbanOrchestrationRepository,
        retrospectives as unknown as KanbanRetrospectiveService,
        settings as unknown as ISystemSettingsReader,
      );
      setOrchestrationMetadata({
        consecutive_failure_count: 3,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 90,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
      });

      await service.checkFailureThreshold("project-1");

      // Post-prune list size = 3 (2 kept + `now`), threshold = 4 → no fire.
      expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();
    });
  });

  describe("fixed window strategy", () => {
    it("resets the count when crossing a 1-minute calendar boundary", async () => {
      // Place the system clock at the start of a fresh 1-minute
      // boundary that is 60 seconds past the previously-seeded window
      // start. The fixed-window cutoff is the start of the current
      // calendar minute, so entries from the prior minute are pruned.
      const newNowEpochSeconds =
        DEFAULT_WINDOW_START_EPOCH_SECONDS + 60; // exactly 60s past window start
      vi.setSystemTime(new Date(newNowEpochSeconds * 1000));
      const settings = buildSystemSettingsReader({
        retrospective_failure_threshold_window_strategy: "fixed",
        retrospective_failure_threshold_window_seconds: 60,
      });
      service = new KanbanRetrospectiveFailureThresholdService(
        orchestrations as unknown as KanbanOrchestrationRepository,
        retrospectives as unknown as KanbanRetrospectiveService,
        settings as unknown as ISystemSettingsReader,
      );
      // Seed the LAST_EMITTED_WINDOW bookkeeping from the prior minute
      // and 5 failures all from that prior window. With fixed strategy,
      // the service computes the new windowStart as
      // Math.floor(newNowEpochSeconds / 60) * 60 and prunes anything
      // < new windowStart.
      const priorMinuteEpochSeconds =
        Math.floor(newNowEpochSeconds / 60) * 60 - 60;
      setOrchestrationMetadata({
        consecutive_failure_count: 5,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          priorMinuteEpochSeconds - 30,
          priorMinuteEpochSeconds - 20,
          priorMinuteEpochSeconds - 10,
          priorMinuteEpochSeconds - 5,
          priorMinuteEpochSeconds,
        ],
        [LAST_EMITTED_WINDOW_METADATA_KEY]: `project-1:${priorMinuteEpochSeconds}`,
        [LAST_EMITTED_AT_METADATA_KEY]: priorMinuteEpochSeconds,
      });

      await service.checkFailureThreshold("project-1");

      // All prior-minute timestamps are pruned (cutoff =
      // Math.floor(newNowEpochSeconds / 60) * 60), and `now` is
      // appended, so the post-prune list has exactly 1 entry.
      expect(orchestrations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [newNowEpochSeconds],
          }),
        }),
      );
      // The new count (1) is below the default threshold (3) so no
      // fire happens despite the prior window's 5 failures.
      expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();
    });
  });

  describe("cooldown semantics", () => {
    it("does NOT fire when within CooldownSeconds since the last emission", async () => {
      const settings = buildSystemSettingsReader({
        retrospective_failure_threshold_cooldown_seconds: 900,
        retrospective_failure_threshold_bypass_cooldown: false,
      });
      service = new KanbanRetrospectiveFailureThresholdService(
        orchestrations as unknown as KanbanOrchestrationRepository,
        retrospectives as unknown as KanbanRetrospectiveService,
        settings as unknown as ISystemSettingsReader,
      );
      // Seed `last_emitted_at` to 100 seconds ago. The in-window
      // count exceeds the threshold but the cooldown must dedupe.
      const oneHundredSecondsAgo = DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 100;
      setOrchestrationMetadata({
        consecutive_failure_count: 4,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 40,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
        [LAST_EMITTED_AT_METADATA_KEY]: oneHundredSecondsAgo,
        [LAST_EMITTED_WINDOW_METADATA_KEY]: `project-1:${oneHundredSecondsAgo - 600}`,
      });

      await service.checkFailureThreshold("project-1");

      // The counter still increments (1 save call) but the trigger
      // does NOT fire because the cooldown is active.
      expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();
    });

    it("fires when within CooldownSeconds but BypassCooldown=true", async () => {
      const settings = buildSystemSettingsReader({
        retrospective_failure_threshold_cooldown_seconds: 900,
        retrospective_failure_threshold_bypass_cooldown: true,
      });
      service = new KanbanRetrospectiveFailureThresholdService(
        orchestrations as unknown as KanbanOrchestrationRepository,
        retrospectives as unknown as KanbanRetrospectiveService,
        settings as unknown as ISystemSettingsReader,
      );
      const oneHundredSecondsAgo = DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 100;
      setOrchestrationMetadata({
        consecutive_failure_count: 4,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 40,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
        [LAST_EMITTED_AT_METADATA_KEY]: oneHundredSecondsAgo,
        [LAST_EMITTED_WINDOW_METADATA_KEY]: `project-1:${oneHundredSecondsAgo - 600}`,
      });

      await service.checkFailureThreshold("project-1");

      // Trigger fires AND the call surfaces the BypassCooldown=true
      // flag so the downstream retrospective service can emit the
      // `kanban.retrospective.cooldown_skipped` audit event.
      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          triggerRevisionMarker: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
          idempotencyKey: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
          bypassCooldown: true,
          windowStartEpochSeconds: DEFAULT_WINDOW_START_EPOCH_SECONDS,
        }),
      );
    });

    it("does not honor the cooldown when CooldownSeconds is 0", async () => {
      const settings = buildSystemSettingsReader({
        retrospective_failure_threshold_cooldown_seconds: 0,
        retrospective_failure_threshold_bypass_cooldown: false,
      });
      service = new KanbanRetrospectiveFailureThresholdService(
        orchestrations as unknown as KanbanOrchestrationRepository,
        retrospectives as unknown as KanbanRetrospectiveService,
        settings as unknown as ISystemSettingsReader,
      );
      const oneSecondAgo = DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 1;
      setOrchestrationMetadata({
        consecutive_failure_count: 4,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 40,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
        [LAST_EMITTED_AT_METADATA_KEY]: oneSecondAgo,
        [LAST_EMITTED_WINDOW_METADATA_KEY]: `project-1:${oneSecondAgo - 600}`,
      });

      await service.checkFailureThreshold("project-1");

      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledTimes(1);
    });
  });

  describe("deterministic trigger revision marker (K5)", () => {
    it("emits an identical triggerRevisionMarker for two back-to-back calls at the same windowStart", async () => {
      // Construct two independent service instances so the dedupe
      // bookkeeping (LAST_EMITTED_WINDOW_METADATA_KEY) does not
      // short-circuit the second call.
      const firstOrchestrations: MockKanbanOrchestrationRepository = {
        findByproject_id: vi.fn().mockResolvedValue({
          project_id: "project-1",
          goals: "test goals",
          mode: "autonomous",
          status: "running",
          linked_run_id: "run-1",
          decision_log: null,
          action_requests: null,
          metadata: {
            consecutive_failure_count: 3,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
            ],
          },
          created_at: new Date("2026-05-16T12:00:00.000Z"),
          updated_at: new Date("2026-05-16T12:00:00.000Z"),
        }),
        save: vi.fn().mockResolvedValue(undefined),
      };
      const firstRetrospectives = {
        runForFailureThreshold: vi.fn().mockResolvedValue({
          status: "completed",
          runId: "retrospective-run-1",
          candidateCount: 1,
        }),
      };
      const firstService = new KanbanRetrospectiveFailureThresholdService(
        firstOrchestrations as unknown as KanbanOrchestrationRepository,
        firstRetrospectives as unknown as KanbanRetrospectiveService,
      );
      await firstService.checkFailureThreshold("project-1");

      const secondOrchestrations: MockKanbanOrchestrationRepository = {
        findByproject_id: vi.fn().mockResolvedValue({
          project_id: "project-1",
          goals: "test goals",
          mode: "autonomous",
          status: "running",
          linked_run_id: "run-1",
          decision_log: null,
          action_requests: null,
          metadata: {
            consecutive_failure_count: 3,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
            ],
          },
          created_at: new Date("2026-05-16T12:00:00.000Z"),
          updated_at: new Date("2026-05-16T12:00:00.000Z"),
        }),
        save: vi.fn().mockResolvedValue(undefined),
      };
      const secondRetrospectives = {
        runForFailureThreshold: vi.fn().mockResolvedValue({
          status: "completed",
          runId: "retrospective-run-1",
          candidateCount: 1,
        }),
      };
      const secondService = new KanbanRetrospectiveFailureThresholdService(
        secondOrchestrations as unknown as KanbanOrchestrationRepository,
        secondRetrospectives as unknown as KanbanRetrospectiveService,
      );
      await secondService.checkFailureThreshold("project-1");

      const firstCallMarker = firstRetrospectives.runForFailureThreshold.mock
        .calls[0]?.[0]?.triggerRevisionMarker;
      const secondCallMarker =
        secondRetrospectives.runForFailureThreshold.mock.calls[0]?.[0]
          ?.triggerRevisionMarker;
      expect(firstCallMarker).toBe(
        `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
      );
      expect(secondCallMarker).toBe(firstCallMarker);
    });

    it("emits different markers when windowStartEpochSeconds differs (e.g. fixed-window calendar roll)", async () => {
      // Different system times land in different 1-minute calendar
      // windows for the fixed strategy, so the marker must change.
      vi.setSystemTime(new Date("2026-05-16T12:00:00.000Z"));
      const firstOrchestrations: MockKanbanOrchestrationRepository = {
        findByproject_id: vi.fn().mockResolvedValue({
          project_id: "project-1",
          goals: "test goals",
          mode: "autonomous",
          status: "running",
          linked_run_id: "run-1",
          decision_log: null,
          action_requests: null,
          metadata: {
            consecutive_failure_count: 3,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
            ],
          },
          created_at: new Date("2026-05-16T12:00:00.000Z"),
          updated_at: new Date("2026-05-16T12:00:00.000Z"),
        }),
        save: vi.fn().mockResolvedValue(undefined),
      };
      const firstRetrospectives = {
        runForFailureThreshold: vi.fn().mockResolvedValue({
          status: "completed",
          runId: "retrospective-run-1",
          candidateCount: 1,
        }),
      };
      const firstService = new KanbanRetrospectiveFailureThresholdService(
        firstOrchestrations as unknown as KanbanOrchestrationRepository,
        firstRetrospectives as unknown as KanbanRetrospectiveService,
      );
      await firstService.checkFailureThreshold("project-1");

      // Advance the system clock by one minute so the fixed-window
      // boundary rolls.
      vi.setSystemTime(new Date("2026-05-16T12:01:00.000Z"));
      const secondOrchestrations: MockKanbanOrchestrationRepository = {
        findByproject_id: vi.fn().mockResolvedValue({
          project_id: "project-1",
          goals: "test goals",
          mode: "autonomous",
          status: "running",
          linked_run_id: "run-1",
          decision_log: null,
          action_requests: null,
          metadata: {
            consecutive_failure_count: 3,
            [FAILURE_TIMESTAMPS_METADATA_KEY]: [
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
              DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
            ],
          },
          created_at: new Date("2026-05-16T12:00:00.000Z"),
          updated_at: new Date("2026-05-16T12:00:00.000Z"),
        }),
        save: vi.fn().mockResolvedValue(undefined),
      };
      const secondRetrospectives = {
        runForFailureThreshold: vi.fn().mockResolvedValue({
          status: "completed",
          runId: "retrospective-run-2",
          candidateCount: 1,
        }),
      };
      const secondService = new KanbanRetrospectiveFailureThresholdService(
        secondOrchestrations as unknown as KanbanOrchestrationRepository,
        secondRetrospectives as unknown as KanbanRetrospectiveService,
      );
      await secondService.checkFailureThreshold("project-1");

      const firstCallMarker = firstRetrospectives.runForFailureThreshold.mock
        .calls[0]?.[0]?.triggerRevisionMarker;
      const secondCallMarker =
        secondRetrospectives.runForFailureThreshold.mock.calls[0]?.[0]
          ?.triggerRevisionMarker;
      expect(firstCallMarker).toBe(
        `failure-threshold:project-1:1778932200`,
      );
      expect(secondCallMarker).toBe(
        `failure-threshold:project-1:1778932260`,
      );
      expect(firstCallMarker).not.toBe(secondCallMarker);
    });

    it("dedupes a retried emission within the same window via the wasWindowAlreadyEmitted bookkeeping", async () => {
      // The marker persisted to LAST_EMITTED_WINDOW_METADATA_KEY is
      // `${projectId}:${windowStartEpochSeconds}`. A second emission
      // in the same window must short-circuit before the cooldown
      // check, so the dedupe survives even with BypassCooldown=true.
      setOrchestrationMetadata({
        consecutive_failure_count: 4,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 40,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 20,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
        [LAST_EMITTED_WINDOW_METADATA_KEY]: `project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
        [LAST_EMITTED_AT_METADATA_KEY]: DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
      });

      await service.checkFailureThreshold("project-1");

      // Second call lands in the same window — must not fire again.
      expect(retrospectives.runForFailureThreshold).not.toHaveBeenCalled();
    });
  });

  describe("pure helpers", () => {
    it("computeWindowStartEpochSeconds returns the floored 60s boundary for fixed windows", () => {
      expect(computeWindowStartEpochSeconds(1778932800, 60, "fixed")).toBe(
        1778932800,
      );
      expect(computeWindowStartEpochSeconds(1778932831, 60, "fixed")).toBe(
        1778932800,
      );
      expect(computeWindowStartEpochSeconds(1778932859, 60, "fixed")).toBe(
        1778932800,
      );
      expect(computeWindowStartEpochSeconds(1778932860, 60, "fixed")).toBe(
        1778932860,
      );
    });

    it("computeWindowStartEpochSeconds returns now - WindowSeconds floored to the 60s boundary for sliding windows", () => {
      // 1778932800 - 600 = 1778932200, already a 60s boundary.
      expect(computeWindowStartEpochSeconds(1778932800, 600, "sliding")).toBe(
        1778932200,
      );
      // 1778932899 - 60 = 1778932839, floor to 1778932800.
      expect(computeWindowStartEpochSeconds(1778932899, 60, "sliding")).toBe(
        1778932800,
      );
      // 1778932900 - 60 = 1778932840, already a 60s boundary.
      expect(computeWindowStartEpochSeconds(1778932900, 60, "sliding")).toBe(
        1778932800,
      );
    });

    it("isCooldownActive returns false when cooldownSeconds is 0", () => {
      expect(
        isCooldownActive(
          {
            [LAST_EMITTED_AT_METADATA_KEY]: DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
          },
          0,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
        ),
      ).toBe(false);
    });

    it("isCooldownActive returns false when last_emitted_at is missing", () => {
      expect(
        isCooldownActive({}, 900, DEFAULT_SYSTEM_TIME_EPOCH_SECONDS),
      ).toBe(false);
    });

    it("isCooldownActive returns true within CooldownSeconds of last_emitted_at", () => {
      const oneHundredSecondsAgo = DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 100;
      expect(
        isCooldownActive(
          { [LAST_EMITTED_AT_METADATA_KEY]: oneHundredSecondsAgo },
          900,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
        ),
      ).toBe(true);
    });

    it("isCooldownActive returns false at or beyond CooldownSeconds", () => {
      const nineHundredSecondsAgo = DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 900;
      expect(
        isCooldownActive(
          { [LAST_EMITTED_AT_METADATA_KEY]: nineHundredSecondsAgo },
          900,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
        ),
      ).toBe(false);
    });

    it("pruneAndAppendFailureTimestamp removes entries outside the sliding window and appends now", () => {
      const result = pruneAndAppendFailureTimestamp(
        [
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 90,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
          DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        ],
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
        60,
        "sliding",
        DEFAULT_WINDOW_START_EPOCH_SECONDS,
      );
      expect(result).toEqual([
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 30,
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - 10,
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS,
      ]);
    });

    it("pruneAndAppendFailureTimestamp respects the fixed-window cutoff (windowStartEpochSeconds)", () => {
      const result = pruneAndAppendFailureTimestamp(
        [
          DEFAULT_WINDOW_START_EPOCH_SECONDS - 1,
          DEFAULT_WINDOW_START_EPOCH_SECONDS,
          DEFAULT_WINDOW_START_EPOCH_SECONDS + 30,
        ],
        DEFAULT_WINDOW_START_EPOCH_SECONDS + 30,
        60,
        "fixed",
        DEFAULT_WINDOW_START_EPOCH_SECONDS,
      );
      // The cutoff is `windowStartEpochSeconds` for the fixed strategy.
      expect(result).toEqual([
        DEFAULT_WINDOW_START_EPOCH_SECONDS,
        DEFAULT_WINDOW_START_EPOCH_SECONDS + 30,
        DEFAULT_WINDOW_START_EPOCH_SECONDS + 30,
      ]);
    });
  });

  describe("env-var fallback chain", () => {
    afterEach(() => {
      delete process.env.FAILURE_THRESHOLD_COUNT;
      delete process.env.RETROSPECTIVE_FAILURE_THRESHOLD_COUNT;
    });

    it("uses RETROSPECTIVE_FAILURE_THRESHOLD_COUNT env var when present", async () => {
      process.env.RETROSPECTIVE_FAILURE_THRESHOLD_COUNT = "8";
      // Construct the service WITHOUT a settings reader so the
      // env-var fallback chain is exercised. The legacy
      // FAILURE_THRESHOLD_COUNT env var takes precedence over
      // RETROSPECTIVE_FAILURE_THRESHOLD_COUNT when both are set, so
      // leave FAILURE_THRESHOLD_COUNT unset here.
      service = new KanbanRetrospectiveFailureThresholdService(
        orchestrations as unknown as KanbanOrchestrationRepository,
        retrospectives as unknown as KanbanRetrospectiveService,
      );
      const priorTimestamps = Array.from({ length: 7 }, (_, i) =>
        DEFAULT_SYSTEM_TIME_EPOCH_SECONDS - (70 - i * 5),
      );
      setOrchestrationMetadata({
        consecutive_failure_count: 7,
        [FAILURE_TIMESTAMPS_METADATA_KEY]: priorTimestamps,
      });

      await service.checkFailureThreshold("project-1");

      expect(retrospectives.runForFailureThreshold).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: `failure-threshold:project-1:${DEFAULT_WINDOW_START_EPOCH_SECONDS}`,
        }),
      );
    });
  });
});
