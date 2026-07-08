import { describe, it, expect, vi } from 'vitest';
import type { HarnessSessionRef } from '@nexus/core';
import { WORKFLOW_RUN_RETRY_SCHEDULED_EVENT } from './workflow-events.constants';
import { scheduleWorkflowAutoRetry } from './workflow-run-retry-policy.helpers';

interface HarnessOverrides {
  autoRetryEnabled?: boolean;
  autoRetryMaxAttempts?: number;
  autoRetryMaxInFlight?: number;
  autoRetryInitialDelayMs?: number;
  autoRetryMaxDelayMs?: number;
  autoRetryBackoffMultiplier?: number;
  autoRetryJitterRatio?: number;
  autoRetryMaxDurationMs?: number;
}

function createHarness(overrides: HarnessOverrides = {}) {
  const stepQueue = {
    add: vi.fn().mockResolvedValue(undefined),
    getJobs: vi.fn().mockResolvedValue([]),
  };
  const stateManager = {
    getVariable: vi.fn().mockResolvedValue(null),
    setVariable: vi.fn().mockResolvedValue(undefined),
  };
  const runRepo = {
    update: vi.fn().mockResolvedValue(undefined),
  };
  const systemSettings = {
    get: vi
      .fn()
      .mockImplementation(async (key: string, defaultValue: unknown) => {
        const store: Record<string, unknown> = {
          workflow_auto_retry_enabled: overrides.autoRetryEnabled ?? true,
          workflow_auto_retry_max_attempts: overrides.autoRetryMaxAttempts ?? 3,
          workflow_auto_retry_initial_delay_ms:
            overrides.autoRetryInitialDelayMs ?? 60000,
          workflow_auto_retry_max_delay_ms:
            overrides.autoRetryMaxDelayMs ?? 300000,
          workflow_auto_retry_backoff_multiplier:
            overrides.autoRetryBackoffMultiplier ?? 2,
          workflow_auto_retry_jitter_ratio: overrides.autoRetryJitterRatio ?? 0,
          workflow_auto_retry_max_in_flight:
            overrides.autoRetryMaxInFlight ?? 5,
          workflow_auto_retry_max_duration_ms:
            overrides.autoRetryMaxDurationMs ?? 86400000,
        };
        return key in store ? store[key] : defaultValue;
      }),
  };
  const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
  const eventEmitter = { emit: vi.fn() };

  return {
    stepQueue,
    stateManager,
    runRepo,
    systemSettings,
    logger,
    eventEmitter,
  };
}

interface ScheduleOverrides {
  jobId?: string;
  runId?: string;
  workflowId?: string;
  reason?: string;
  reasonCode?: string;
  loadWorkflowDefinition?: ReturnType<typeof vi.fn>;
  resume?: { resumeSessionRef: HarnessSessionRef };
  firstFailureAtOverride?: string | null;
  retryDelayMsOverride?: number;
  allowWhenWorkflowAutoRetryDisabled?: boolean;
}

async function schedule(overrides: ScheduleOverrides = {}) {
  const harness = createHarness();
  const loadWorkflowDefinition =
    overrides.loadWorkflowDefinition ??
    vi.fn().mockResolvedValue({
      workflow_id: 'wf-1',
      name: 'WF 1',
      jobs: [
        {
          id: overrides.jobId ?? 'implement_and_commit',
          agent: 'claude_code',
          prompt: 'do it',
        },
      ],
    });

  if (overrides.firstFailureAtOverride !== undefined) {
    harness.stateManager.getVariable.mockImplementation(
      async (runId: string, key: string) => {
        if (
          key ===
          `_internal.auto_retry.${overrides.jobId ?? 'implement_and_commit'}.first_failure_at`
        ) {
          return overrides.firstFailureAtOverride;
        }
        return null;
      },
    );
  }

  const result = await scheduleWorkflowAutoRetry({
    run: {
      id: overrides.runId ?? 'run-1',
      workflow_id: overrides.workflowId ?? 'wf-1',
    },
    jobId: overrides.jobId ?? 'implement_and_commit',
    reason:
      overrides.reason ??
      'HTTP POST timed out: http://172.18.0.10:8374/execute/agent',
    reasonCode: overrides.reasonCode ?? 'agent_transport_timeout',
    resume: overrides.resume,
    retryDelayMsOverride: overrides.retryDelayMsOverride,
    allowWhenWorkflowAutoRetryDisabled:
      overrides.allowWhenWorkflowAutoRetryDisabled,
    loadWorkflowDefinition: loadWorkflowDefinition as never,
    stateManager: harness.stateManager as never,
    runRepo: harness.runRepo as never,
    stepQueue: harness.stepQueue as never,
    eventEmitter: harness.eventEmitter as never,
    systemSettings: harness.systemSettings as never,
    logger: harness.logger as never,
  });

  return { result, harness, loadWorkflowDefinition };
}

describe('scheduleWorkflowAutoRetry — resume ref threading', () => {
  it('threads the resume ref into the re-enqueued job data', async () => {
    const resumeRef: HarnessSessionRef = {
      kind: 'claude_code',
      sessionId: 'sess-1',
    };

    const { result, harness } = await schedule({
      resume: { resumeSessionRef: resumeRef },
    });

    expect(result).toBe(true);
    expect(harness.stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        autoRetry: expect.objectContaining({
          resume: { resumeSessionRef: resumeRef },
        }),
      }),
      expect.any(Object),
    );
  });
});

describe('scheduleWorkflowAutoRetry — workflow YAML skills threading', () => {
  it('carries workflow-level YAML skills into the re-enqueued job data', async () => {
    const loadWorkflowDefinition = vi.fn().mockResolvedValue({
      workflow_id: 'wf-1',
      name: 'WF 1',
      skills: ['git-commit-discipline'],
      jobs: [
        {
          id: 'implement_and_commit',
          agent: 'claude_code',
          prompt: 'do it',
        },
      ],
    });

    const { result, harness } = await schedule({ loadWorkflowDefinition });

    expect(result).toBe(true);
    expect(harness.stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        workflowYamlSkills: ['git-commit-discipline'],
      }),
      expect.any(Object),
    );
  });
});

describe('scheduleWorkflowAutoRetry — happy path', () => {
  it('schedules a retry when the workflow auto-retry gate is enabled', async () => {
    const { result, harness } = await schedule();

    expect(result).toBe(true);
    expect(harness.stepQueue.add).toHaveBeenCalledTimes(1);

    // Attempt was incremented from 0 -> 1 and persisted.
    expect(harness.stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.auto_retry.implement_and_commit.attempt',
      1,
    );

    // Enqueue payload shape: caller identity + autoRetry metadata + delay.
    expect(harness.stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'implement_and_commit',
        job: expect.objectContaining({ id: 'implement_and_commit' }),
        autoRetry: expect.objectContaining({
          attempt: 1,
          retryQueueJobId: 'auto-retry-run-1-implement_and_commit',
        }),
      }),
      expect.objectContaining({
        delay: 60000,
        attempts: 1,
        jobId: 'auto-retry-run-1-implement_and_commit',
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );

    // current_step_id was pinned onto the run.
    expect(harness.runRepo.update).toHaveBeenCalledWith('run-1', {
      current_step_id: 'implement_and_commit',
    });

    // Telemetry event emission.
    expect(harness.eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_RETRY_SCHEDULED_EVENT,
      expect.objectContaining({
        workflowRunId: 'run-1',
        workflowId: 'wf-1',
        jobId: 'implement_and_commit',
        payload: expect.objectContaining({
          attempt: 1,
          maxAttempts: 3,
          reasonCode: 'agent_transport_timeout',
        }),
      }),
    );
  });

  it('persists last_failure metadata with the canonical fields', async () => {
    const { harness } = await schedule({
      reasonCode: 'agent_transport_timeout',
    });

    expect(harness.stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.auto_retry.implement_and_commit.last_failure',
      expect.objectContaining({
        reason: expect.any(String),
        reasonCode: 'agent_transport_timeout',
        attempt: 1,
        retryQueueJobId: 'auto-retry-run-1-implement_and_commit',
        nextRetryAt: expect.any(String),
      }),
    );
  });

  it('skips scheduling entirely when the gate is disabled and no escape hatch is set', async () => {
    const { result, harness } = await schedule();

    // Replace the gate to disabled by re-creating the harness.
    const disabledHarness = createHarness({ autoRetryEnabled: false });
    const disabledResult = await scheduleWorkflowAutoRetry({
      run: { id: 'run-1', workflow_id: 'wf-1' },
      jobId: 'implement_and_commit',
      reason: 'whatever',
      loadWorkflowDefinition: vi.fn().mockResolvedValue({
        workflow_id: 'wf-1',
        name: 'WF 1',
        jobs: [{ id: 'implement_and_commit' }],
      }) as never,
      stateManager: disabledHarness.stateManager as never,
      runRepo: disabledHarness.runRepo as never,
      stepQueue: disabledHarness.stepQueue as never,
      eventEmitter: disabledHarness.eventEmitter as never,
      systemSettings: disabledHarness.systemSettings as never,
      logger: disabledHarness.logger as never,
    });

    expect(disabledResult).toBe(false);
    expect(disabledHarness.stepQueue.add).not.toHaveBeenCalled();
    expect(disabledHarness.eventEmitter.emit).not.toHaveBeenCalled();
    expect(result).toBe(true); // the first call above used the default-on harness
    expect(harness.stepQueue.add).toHaveBeenCalled();
  });

  it('honors allowWhenWorkflowAutoRetryDisabled to escape a disabled workflow-level gate', async () => {
    const harness = createHarness({ autoRetryEnabled: false });

    const result = await scheduleWorkflowAutoRetry({
      run: { id: 'run-1', workflow_id: 'wf-1' },
      jobId: 'implement_and_commit',
      reason: 'whatever',
      allowWhenWorkflowAutoRetryDisabled: true,
      loadWorkflowDefinition: vi.fn().mockResolvedValue({
        workflow_id: 'wf-1',
        name: 'WF 1',
        jobs: [{ id: 'implement_and_commit' }],
      }) as never,
      stateManager: harness.stateManager as never,
      runRepo: harness.runRepo as never,
      stepQueue: harness.stepQueue as never,
      eventEmitter: harness.eventEmitter as never,
      systemSettings: harness.systemSettings as never,
      logger: harness.logger as never,
    });

    expect(result).toBe(true);
    expect(harness.stepQueue.add).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleWorkflowAutoRetry — 429 indefinite retry window', () => {
  it('schedules a retry for provider_rate_limit_429 within the configured duration window', async () => {
    const now = Date.now();
    // First failure 1 hour ago — still inside the default 24h window.
    const firstFailureAt = new Date(now - 60 * 60 * 1000).toISOString();

    const { result, harness } = await schedule({
      reasonCode: 'provider_rate_limit_429',
      firstFailureAtOverride: firstFailureAt,
    });

    expect(result).toBe(true);
    expect(harness.stepQueue.add).toHaveBeenCalledTimes(1);
    // State variable should be present even when reasons are indefinite.
    expect(harness.stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.auto_retry.implement_and_commit.attempt',
      1,
    );
    expect(harness.eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_RETRY_SCHEDULED_EVENT,
      expect.objectContaining({
        payload: expect.objectContaining({
          reasonCode: 'provider_rate_limit_429',
        }),
      }),
    );
  });

  it('refuses to schedule a provider_rate_limit_429 retry once the duration cap is exceeded', async () => {
    const now = Date.now();
    // First failure 48 hours ago — exceeds the default 24h window.
    const firstFailureAt = new Date(now - 48 * 60 * 60 * 1000).toISOString();

    const { result, harness } = await schedule({
      reasonCode: 'provider_rate_limit_429',
      firstFailureAtOverride: firstFailureAt,
    });

    expect(result).toBe(false);
    expect(harness.stepQueue.add).not.toHaveBeenCalled();
    expect(harness.runRepo.update).not.toHaveBeenCalled();
    expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
  });
});

describe('scheduleWorkflowAutoRetry — capacity rejection', () => {
  it('refuses to schedule when the in-flight auto-retry limit is reached', async () => {
    const harness = createHarness({
      autoRetryMaxInFlight: 5,
    });

    // Construct five synthetic in-flight auto-retry jobs that count toward the cap.
    const inFlightJobs = Array.from({ length: 5 }, (_, i) => ({
      id: `auto-retry-other-run-other-job-${i}`,
    }));
    harness.stepQueue.getJobs.mockResolvedValue(inFlightJobs);

    const result = await scheduleWorkflowAutoRetry({
      run: { id: 'run-1', workflow_id: 'wf-1' },
      jobId: 'implement_and_commit',
      reason: 'whatever',
      loadWorkflowDefinition: vi.fn().mockResolvedValue({
        workflow_id: 'wf-1',
        name: 'WF 1',
        jobs: [{ id: 'implement_and_commit' }],
      }) as never,
      stateManager: harness.stateManager as never,
      runRepo: harness.runRepo as never,
      stepQueue: harness.stepQueue as never,
      eventEmitter: harness.eventEmitter as never,
      systemSettings: harness.systemSettings as never,
      logger: harness.logger as never,
    });

    expect(result).toBe(false);
    expect(harness.stepQueue.add).not.toHaveBeenCalled();
    expect(harness.runRepo.update).not.toHaveBeenCalled();
    expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('in-flight auto-retry limit reached'),
    );
  });

  it('only counts jobs whose queue id carries the auto-retry prefix', async () => {
    const harness = createHarness({
      autoRetryMaxInFlight: 2,
    });

    const liveJobs = [
      { id: 'workflow-step-run-1-job-1' },
      { id: 'workflow-step-run-1-job-2' },
      { id: 'workflow-step-run-1-job-3' },
      { id: 'auto-retry-run-1-other-job' },
    ];
    harness.stepQueue.getJobs.mockResolvedValue(liveJobs);

    const result = await scheduleWorkflowAutoRetry({
      run: { id: 'run-1', workflow_id: 'wf-1' },
      jobId: 'implement_and_commit',
      reason: 'whatever',
      loadWorkflowDefinition: vi.fn().mockResolvedValue({
        workflow_id: 'wf-1',
        name: 'WF 1',
        jobs: [{ id: 'implement_and_commit' }],
      }) as never,
      stateManager: harness.stateManager as never,
      runRepo: harness.runRepo as never,
      stepQueue: harness.stepQueue as never,
      eventEmitter: harness.eventEmitter as never,
      systemSettings: harness.systemSettings as never,
      logger: harness.logger as never,
    });

    // Only 1 auto-retry-prefixed job in flight, capacity is 2 -> schedule proceeds.
    expect(result).toBe(true);
    expect(harness.stepQueue.add).toHaveBeenCalledTimes(1);
  });
});
