import { describe, expect, it } from 'vitest';
import {
  classifyExecutionForReaping,
  DEFAULT_CONTAINER_LOST_GRACE_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_RUNTIME_MS,
  DEFAULT_PROVISION_GRACE_MS,
  DURABLE_OUTPUT_QUIESCENCE_MS,
  RECONCILE_GRACE_MS,
  WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS,
  resolveContainerLostGraceMs,
  resolveIdleTimeoutMs,
  resolveProvisionGraceMs,
} from './execution-supervision.helpers';

const base = {
  state: 'running' as const,
  createdAtMs: 0,
  lastHeartbeatAtMs: 0,
  containerLost: false,
};

describe('classifyExecutionForReaping', () => {
  it('does not reap an actively-heartbeating execution past 30 minutes', () => {
    const now = 45 * 60_000;
    const verdict = classifyExecutionForReaping(
      { ...base, createdAtMs: 0, lastHeartbeatAtMs: now - 10_000 },
      now,
    );
    expect(verdict).toBeNull();
  });

  it('reaps idle_timeout when no heartbeat within the idle window', () => {
    const now = 45 * 60_000;
    const verdict = classifyExecutionForReaping(
      { ...base, lastHeartbeatAtMs: now - (DEFAULT_IDLE_TIMEOUT_MS + 1) },
      now,
    );
    expect(verdict).toEqual({ kind: 'reap', reason: 'idle_timeout' });
  });

  it('debounces container_lost for all kinds: null lostForMs stays within grace', () => {
    const now = 60_000;
    const withinGrace = classifyExecutionForReaping(
      { ...base, lastHeartbeatAtMs: now, containerLost: true },
      now,
    );
    expect(withinGrace).toBeNull();

    const beyondGrace = classifyExecutionForReaping(
      {
        ...base,
        lastHeartbeatAtMs: now,
        containerLost: true,
        containerLostForMs: DEFAULT_CONTAINER_LOST_GRACE_MS,
      },
      now,
    );
    expect(beyondGrace).toEqual({ kind: 'reap', reason: 'container_lost' });
  });

  it('reaps max_runtime_exceeded past the hard ceiling even if active', () => {
    const now = DEFAULT_MAX_RUNTIME_MS + 1;
    const verdict = classifyExecutionForReaping(
      { ...base, createdAtMs: 0, lastHeartbeatAtMs: now - 1_000 },
      now,
    );
    expect(verdict).toEqual({ kind: 'reap', reason: 'max_runtime_exceeded' });
  });

  it('never idle-reaps an awaiting_input execution', () => {
    const now = 60 * 60_000;
    const verdict = classifyExecutionForReaping(
      {
        ...base,
        state: 'awaiting_input',
        lastHeartbeatAtMs: now - (DEFAULT_IDLE_TIMEOUT_MS + 1),
      },
      now,
    );
    expect(verdict).toBeNull();
  });

  it('reads idle timeout from env, falling back on invalid input', () => {
    expect(resolveIdleTimeoutMs('600000')).toBe(600_000);
    expect(resolveIdleTimeoutMs('nope')).toBe(DEFAULT_IDLE_TIMEOUT_MS);
    expect(resolveIdleTimeoutMs(undefined)).toBe(DEFAULT_IDLE_TIMEOUT_MS);
  });

  it('does not idle-reap a workflow_step execution regardless of heartbeat age', () => {
    const now = 45 * 60_000;
    const verdict = classifyExecutionForReaping(
      { ...base, kind: 'workflow_step', lastHeartbeatAtMs: 0 },
      now,
    );
    expect(verdict).toBeNull();
  });

  it('reaps a workflow_step when its owner lease expired and the job is quiescent', () => {
    const now = Date.parse('2026-06-30T12:10:00.000Z');

    const decision = classifyExecutionForReaping(
      {
        kind: 'workflow_step',
        state: 'running',
        createdAtMs: now - 10 * 60_000,
        lastHeartbeatAtMs: now - 10 * 60_000,
        containerLost: false,
        ownerLeaseExpiredForMs: WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS,
        latestJobActivityQuiescentForMs: WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS,
      },
      now,
    );

    expect(decision).toEqual({ kind: 'reap', reason: 'idle_timeout' });
  });

  it('does not reap a workflow_step while its owner lease is active', () => {
    const now = Date.parse('2026-06-30T12:10:00.000Z');

    const decision = classifyExecutionForReaping(
      {
        kind: 'workflow_step',
        state: 'running',
        createdAtMs: now - 10 * 60_000,
        lastHeartbeatAtMs: now - 10 * 60_000,
        containerLost: false,
        ownerLeaseExpiredForMs: null,
        latestJobActivityQuiescentForMs: WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS,
      },
      now,
    );

    expect(decision).toBeNull();
  });

  it('does not reap a workflow_step with recent job activity', () => {
    const now = Date.parse('2026-06-30T12:10:00.000Z');

    const decision = classifyExecutionForReaping(
      {
        kind: 'workflow_step',
        state: 'running',
        createdAtMs: now - 10 * 60_000,
        lastHeartbeatAtMs: now - 10 * 60_000,
        containerLost: false,
        ownerLeaseExpiredForMs: WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS,
        latestJobActivityQuiescentForMs:
          WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS - 1,
      },
      now,
    );

    expect(decision).toBeNull();
  });

  it('does NOT reap a workflow_step on the first lost observation (within grace)', () => {
    const now = 60_000;
    const verdict = classifyExecutionForReaping(
      {
        ...base,
        kind: 'workflow_step',
        containerLost: true,
        containerLostForMs: null,
      },
      now,
    );
    expect(verdict).toBeNull();
  });

  it('does NOT reap a workflow_step when lost shorter than the grace window', () => {
    const now = 60_000;
    const verdict = classifyExecutionForReaping(
      {
        ...base,
        kind: 'workflow_step',
        containerLost: true,
        containerLostForMs: DEFAULT_CONTAINER_LOST_GRACE_MS - 1,
      },
      now,
    );
    expect(verdict).toBeNull();
  });

  it('reaps a workflow_step container_lost once the grace window elapses', () => {
    const now = 60_000;
    const verdict = classifyExecutionForReaping(
      {
        ...base,
        kind: 'workflow_step',
        containerLost: true,
        containerLostForMs: DEFAULT_CONTAINER_LOST_GRACE_MS,
      },
      now,
    );
    expect(verdict).toEqual({ kind: 'reap', reason: 'container_lost' });
  });

  it('debounces container_lost for a subagent kind too', () => {
    const now = 60_000;
    const withinGrace = classifyExecutionForReaping(
      {
        ...base,
        kind: 'subagent',
        containerLost: true,
        containerLostForMs: null,
      },
      now,
    );
    expect(withinGrace).toBeNull();

    const beyondGrace = classifyExecutionForReaping(
      {
        ...base,
        kind: 'subagent',
        containerLost: true,
        containerLostForMs: DEFAULT_CONTAINER_LOST_GRACE_MS,
      },
      now,
    );
    expect(beyondGrace).toEqual({ kind: 'reap', reason: 'container_lost' });
  });

  it('reaps a workflow_step for max_runtime even while container_lost is within grace', () => {
    const now = DEFAULT_MAX_RUNTIME_MS + 1;
    const verdict = classifyExecutionForReaping(
      {
        ...base,
        kind: 'workflow_step',
        createdAtMs: 0,
        containerLost: true,
        containerLostForMs: 0,
      },
      now,
    );
    expect(verdict).toEqual({ kind: 'reap', reason: 'max_runtime_exceeded' });
  });

  it('reads container-lost grace from env, falling back on invalid input', () => {
    expect(resolveContainerLostGraceMs('120000')).toBe(120_000);
    expect(resolveContainerLostGraceMs('nope')).toBe(
      DEFAULT_CONTAINER_LOST_GRACE_MS,
    );
    expect(resolveContainerLostGraceMs(undefined)).toBe(
      DEFAULT_CONTAINER_LOST_GRACE_MS,
    );
  });

  it('still reaps workflow_step for max_runtime_exceeded', () => {
    const now = DEFAULT_MAX_RUNTIME_MS + 1;
    const verdict = classifyExecutionForReaping(
      {
        ...base,
        kind: 'workflow_step',
        createdAtMs: 0,
        lastHeartbeatAtMs: now,
      },
      now,
    );
    expect(verdict).toEqual({ kind: 'reap', reason: 'max_runtime_exceeded' });
  });

  it('reaps spawn_timeout for a provisioning execution older than the grace window', () => {
    const now = DEFAULT_PROVISION_GRACE_MS + 1;
    const verdict = classifyExecutionForReaping(
      { ...base, state: 'provisioning', createdAtMs: 0 },
      now,
    );
    expect(verdict).toEqual({ kind: 'reap', reason: 'spawn_timeout' });
  });

  it('does not reap a provisioning execution younger than the grace window', () => {
    const now = DEFAULT_PROVISION_GRACE_MS - 1;
    const verdict = classifyExecutionForReaping(
      { ...base, state: 'provisioning', createdAtMs: 0 },
      now,
    );
    expect(verdict).toBeNull();
  });

  it('does not apply spawn_timeout to a running execution older than the grace window', () => {
    const now = DEFAULT_PROVISION_GRACE_MS + 1;
    const verdict = classifyExecutionForReaping(
      {
        ...base,
        state: 'running',
        createdAtMs: 0,
        lastHeartbeatAtMs: now - 1_000,
      },
      now,
    );
    expect(verdict).not.toBe('spawn_timeout');
  });

  it('reads provision grace from env, falling back on invalid input', () => {
    expect(resolveProvisionGraceMs('120000')).toBe(120_000);
    expect(resolveProvisionGraceMs('nope')).toBe(DEFAULT_PROVISION_GRACE_MS);
    expect(resolveProvisionGraceMs(undefined)).toBe(DEFAULT_PROVISION_GRACE_MS);
  });

  it('reaps never_dispatched for a pending execution older than the provision grace window', () => {
    const now = DEFAULT_PROVISION_GRACE_MS + 1;
    const verdict = classifyExecutionForReaping(
      { ...base, state: 'pending', createdAtMs: 0 },
      now,
    );
    expect(verdict).toEqual({ kind: 'reap', reason: 'never_dispatched' });
  });

  it('does not reap a pending execution younger than the provision grace window', () => {
    const now = DEFAULT_PROVISION_GRACE_MS - 1;
    const verdict = classifyExecutionForReaping(
      { ...base, state: 'pending', createdAtMs: 0 },
      now,
    );
    expect(verdict).toBeNull();
  });

  it('applies spawn_timeout (not never_dispatched) to a provisioning execution past the grace window', () => {
    const now = DEFAULT_PROVISION_GRACE_MS + 1;
    const verdict = classifyExecutionForReaping(
      { ...base, state: 'provisioning', createdAtMs: 0 },
      now,
    );
    expect(verdict).toEqual({ kind: 'reap', reason: 'spawn_timeout' });
  });

  it('does not reap a workflow_step container_lost while a child subagent is live', () => {
    const now = 60_000;
    const input = {
      kind: 'workflow_step' as const,
      state: 'running' as const,
      createdAtMs: now - 60_000,
      lastHeartbeatAtMs: now - 60_000,
      containerLost: true,
      containerLostForMs: 999_999,
      hasLiveChildSubagent: true,
    };
    expect(classifyExecutionForReaping(input, now)).toBeNull();
  });

  it('still reaps a workflow_step container_lost when no child subagent is live', () => {
    const now = 60_000;
    const input = {
      kind: 'workflow_step' as const,
      state: 'running' as const,
      createdAtMs: now - 60_000,
      lastHeartbeatAtMs: now - 60_000,
      containerLost: true,
      containerLostForMs: 999_999,
      hasLiveChildSubagent: false,
    };
    expect(classifyExecutionForReaping(input, now)).toEqual({
      kind: 'reap',
      reason: 'container_lost',
    });
  });

  describe('reconcile_completed branch', () => {
    const reconcileBase = {
      kind: 'workflow_step' as const,
      state: 'running' as const,
      createdAtMs: 0,
      lastHeartbeatAtMs: 0,
      containerLost: false as const,
      hasLiveChildSubagent: false,
    };

    it('returns reconcile_completed when agent ended past the grace window with success', () => {
      const now = RECONCILE_GRACE_MS + 1;
      const verdict = classifyExecutionForReaping(
        {
          ...reconcileBase,
          agentEndedForMs: RECONCILE_GRACE_MS,
          agentEndedOutcome: 'success',
        },
        now,
      );
      expect(verdict).toEqual({ kind: 'reconcile_completed' });
    });

    it('returns reconcile_completed when outcome is unspecified (defaults to success)', () => {
      const now = RECONCILE_GRACE_MS + 1;
      const verdict = classifyExecutionForReaping(
        { ...reconcileBase, agentEndedForMs: RECONCILE_GRACE_MS },
        now,
      );
      expect(verdict).toEqual({ kind: 'reconcile_completed' });
    });

    it('returns reconcile_failed when agent ended past the grace window with failure', () => {
      const now = RECONCILE_GRACE_MS + 1;
      const verdict = classifyExecutionForReaping(
        {
          ...reconcileBase,
          agentEndedForMs: RECONCILE_GRACE_MS,
          agentEndedOutcome: 'failure',
        },
        now,
      );
      expect(verdict).toEqual({ kind: 'reconcile_failed' });
    });

    it('returns null (not reconcile) when agent ended but within the grace window', () => {
      const now = RECONCILE_GRACE_MS - 1;
      const verdict = classifyExecutionForReaping(
        { ...reconcileBase, agentEndedForMs: RECONCILE_GRACE_MS - 1 },
        now,
      );
      expect(verdict).toBeNull();
    });

    it('returns null when agentEndedForMs is null (agent not yet ended)', () => {
      const now = RECONCILE_GRACE_MS + 10_000;
      const verdict = classifyExecutionForReaping(
        { ...reconcileBase, agentEndedForMs: null },
        now,
      );
      expect(verdict).toBeNull();
    });

    it('returns null when a live child subagent exists even if agent ended past grace', () => {
      const now = RECONCILE_GRACE_MS + 10_000;
      const verdict = classifyExecutionForReaping(
        {
          ...reconcileBase,
          hasLiveChildSubagent: true,
          agentEndedForMs: RECONCILE_GRACE_MS,
        },
        now,
      );
      expect(verdict).toBeNull();
    });

    it('reaps max_runtime_exceeded even when agent ended (max_runtime wins)', () => {
      const now = DEFAULT_MAX_RUNTIME_MS + 1;
      const verdict = classifyExecutionForReaping(
        {
          ...reconcileBase,
          createdAtMs: 0,
          agentEndedForMs: RECONCILE_GRACE_MS,
        },
        now,
      );
      expect(verdict).toEqual({ kind: 'reap', reason: 'max_runtime_exceeded' });
    });

    it('does not reconcile when container is lost', () => {
      const now = RECONCILE_GRACE_MS + 10_000;
      const verdict = classifyExecutionForReaping(
        {
          ...reconcileBase,
          containerLost: true,
          containerLostForMs: 999_999,
          agentEndedForMs: RECONCILE_GRACE_MS,
        },
        now,
      );
      // container_lost beats reconcile because it runs first; returns reap
      expect(verdict).toEqual({ kind: 'reap', reason: 'container_lost' });
    });
  });

  describe('durable-output reconcile branch', () => {
    const durableBase = {
      kind: 'workflow_step' as const,
      state: 'running' as const,
      createdAtMs: 0,
      lastHeartbeatAtMs: 0,
      containerLost: false as const,
      hasLiveChildSubagent: false,
    };

    it('reconciles to completed when output persisted and the job is quiescent past the window', () => {
      const now = DURABLE_OUTPUT_QUIESCENCE_MS + 10_000;
      const verdict = classifyExecutionForReaping(
        {
          ...durableBase,
          durableOutputPersisted: true,
          durableOutputQuiescentForMs: DURABLE_OUTPUT_QUIESCENCE_MS,
        },
        now,
      );
      expect(verdict).toEqual({ kind: 'reconcile_completed' });
    });

    it('returns null while still within the quiescence window (agent may be mid-loop)', () => {
      const now = DURABLE_OUTPUT_QUIESCENCE_MS + 10_000;
      const verdict = classifyExecutionForReaping(
        {
          ...durableBase,
          durableOutputPersisted: true,
          durableOutputQuiescentForMs: DURABLE_OUTPUT_QUIESCENCE_MS - 1,
        },
        now,
      );
      expect(verdict).toBeNull();
    });

    it('returns null when no durable output has been persisted', () => {
      const now = DURABLE_OUTPUT_QUIESCENCE_MS + 10_000;
      const verdict = classifyExecutionForReaping(
        {
          ...durableBase,
          durableOutputPersisted: false,
          durableOutputQuiescentForMs: DURABLE_OUTPUT_QUIESCENCE_MS,
        },
        now,
      );
      expect(verdict).toBeNull();
    });

    it('prefers the agent-end signal over the durable-output fallback', () => {
      const now = DURABLE_OUTPUT_QUIESCENCE_MS + 10_000;
      const verdict = classifyExecutionForReaping(
        {
          ...durableBase,
          agentEndedForMs: RECONCILE_GRACE_MS,
          agentEndedOutcome: 'failure',
          durableOutputPersisted: true,
          durableOutputQuiescentForMs: DURABLE_OUTPUT_QUIESCENCE_MS,
        },
        now,
      );
      expect(verdict).toEqual({ kind: 'reconcile_failed' });
    });

    it('does not reconcile from durable output while a live child subagent exists', () => {
      const now = DURABLE_OUTPUT_QUIESCENCE_MS + 10_000;
      const verdict = classifyExecutionForReaping(
        {
          ...durableBase,
          hasLiveChildSubagent: true,
          durableOutputPersisted: true,
          durableOutputQuiescentForMs: DURABLE_OUTPUT_QUIESCENCE_MS,
        },
        now,
      );
      expect(verdict).toBeNull();
    });

    it('lets max_runtime win over the durable-output reconcile', () => {
      const now = DEFAULT_MAX_RUNTIME_MS + 1;
      const verdict = classifyExecutionForReaping(
        {
          ...durableBase,
          createdAtMs: 0,
          durableOutputPersisted: true,
          durableOutputQuiescentForMs: DURABLE_OUTPUT_QUIESCENCE_MS,
        },
        now,
      );
      expect(verdict).toEqual({ kind: 'reap', reason: 'max_runtime_exceeded' });
    });
  });
});
