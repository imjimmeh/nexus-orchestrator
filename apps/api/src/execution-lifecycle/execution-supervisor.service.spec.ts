import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ExecutionSupervisorService } from './execution-supervisor.service';
import {
  DEFAULT_PROVISION_GRACE_MS,
  DURABLE_OUTPUT_QUIESCENCE_MS,
  RECONCILE_GRACE_MS,
  WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS,
} from './execution-supervision.helpers';
import { checkpointSidecarHostPath } from '../workflow/workflow-session-checkpoint/checkpoint-sidecar-path';
import { ServiceLifecycleStateService } from './service-lifecycle-state.service';
import { ShutdownStateService } from '../shutdown/shutdown-state.service';

function makeRunningLifecycle(): ServiceLifecycleStateService {
  const lc = new ServiceLifecycleStateService();
  lc.markRunning();
  return lc;
}

function makeShutdownState(isShuttingDown = false): ShutdownStateService {
  const svc = new ShutdownStateService();
  vi.spyOn(svc, 'isShuttingDown').mockReturnValue(isShuttingDown);
  return svc;
}

describe('ExecutionSupervisorService.sweepOnce', () => {
  it('emits reaped for an idle execution and skips an active one', async () => {
    const now = 60 * 60_000;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'idle',
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: new Date(0),
          container_id: 'c1',
        },
        {
          id: 'busy',
          state: 'running',
          created_at: new Date(now - 1000),
          last_heartbeat_at: new Date(now - 1000),
          container_id: 'c2',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      undefined,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(publisher.reaped).toHaveBeenCalledTimes(1);
    expect(publisher.reaped).toHaveBeenCalledWith(
      'idle',
      expect.objectContaining({ failure_reason: 'idle_timeout' }),
    );
  });

  it('does not reap a workflow_step execution even past the idle timeout', async () => {
    const now = 60 * 60_000;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'step-exec',
          kind: 'workflow_step',
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: null,
          container_id: null,
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      undefined,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(publisher.reaped).not.toHaveBeenCalled();
  });

  it('does not reap a workflow_step on the first sweep its container is lost', async () => {
    const now = 60 * 60_000;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'step-lost',
          kind: 'workflow_step',
          state: 'running',
          created_at: new Date(now - 1000),
          last_heartbeat_at: null,
          container_id: 'gone',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(true) };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      undefined,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(publisher.reaped).not.toHaveBeenCalled();
  });

  it('reaps a workflow_step whose container stays lost beyond the grace window', async () => {
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'step-orphan',
          kind: 'workflow_step',
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: null,
          container_id: 'gone',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(true) };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      undefined,
    );

    const clock = { value: 0 };
    (service as unknown as { now: () => number }).now = () => clock.value;

    // First sweep records the lost-since timestamp but does not reap.
    await service.sweepOnce();
    expect(publisher.reaped).not.toHaveBeenCalled();

    // Advance past the grace window and sweep again with the container still lost.
    clock.value = 100_000; // > DEFAULT_CONTAINER_LOST_GRACE_MS (90_000)
    await service.sweepOnce();

    expect(publisher.reaped).toHaveBeenCalledTimes(1);
    expect(publisher.reaped).toHaveBeenCalledWith(
      'step-orphan',
      expect.objectContaining({ failure_reason: 'container_lost' }),
    );
  });

  it('clears lost tracking when a workflow_step container recovers', async () => {
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'step-flap',
          kind: 'workflow_step',
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: null,
          container_id: 'flap',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = {
      isContainerLost: vi
        .fn()
        .mockResolvedValueOnce(true) // sweep 1: lost
        .mockResolvedValueOnce(false) // sweep 2: recovered
        .mockResolvedValue(true), // sweep 3: lost again (tracking restarted)
    };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      undefined,
    );
    const clock = { value: 0 };
    (service as unknown as { now: () => number }).now = () => clock.value;

    await service.sweepOnce(); // records lost-since at 0
    clock.value = 100_000;
    await service.sweepOnce(); // recovered -> tracking cleared
    clock.value = 150_000;
    await service.sweepOnce(); // lost again -> lost-since restarts at 150_000

    // Still within grace relative to the restarted lost-since, so no reap.
    expect(publisher.reaped).not.toHaveBeenCalled();
  });

  it('reaps spawn_timeout for a provisioning execution stuck beyond the provision grace window', async () => {
    const now = DEFAULT_PROVISION_GRACE_MS + 1;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'stuck-spawn',
          kind: 'subagent',
          state: 'provisioning',
          created_at: new Date(0),
          last_heartbeat_at: null,
          container_id: null,
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      undefined,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(publisher.reaped).toHaveBeenCalledTimes(1);
    expect(publisher.reaped).toHaveBeenCalledWith(
      'stuck-spawn',
      expect.objectContaining({ failure_reason: 'spawn_timeout' }),
    );
  });

  it('reaps never_dispatched for a pending execution stuck beyond the provision grace window', async () => {
    const now = DEFAULT_PROVISION_GRACE_MS + 1;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'stuck-pending',
          kind: 'subagent',
          state: 'pending',
          created_at: new Date(0),
          last_heartbeat_at: null,
          container_id: null,
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      undefined,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(publisher.reaped).toHaveBeenCalledTimes(1);
    expect(publisher.reaped).toHaveBeenCalledWith(
      'stuck-pending',
      expect.objectContaining({ failure_reason: 'never_dispatched' }),
    );
  });

  it('debounces container_lost for a subagent kind: not reaped on first sweep, reaped after grace window', async () => {
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'subagent-lost',
          kind: 'subagent',
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: new Date(0),
          container_id: 'gone',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(true) };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      undefined,
    );

    const clock = { value: 0 };
    (service as unknown as { now: () => number }).now = () => clock.value;

    // First sweep records the lost-since timestamp but does not reap.
    await service.sweepOnce();
    expect(publisher.reaped).not.toHaveBeenCalled();

    // Advance past the grace window and sweep again with the container still lost.
    clock.value = 100_000; // > DEFAULT_CONTAINER_LOST_GRACE_MS (90_000)
    await service.sweepOnce();

    expect(publisher.reaped).toHaveBeenCalledTimes(1);
    expect(publisher.reaped).toHaveBeenCalledWith(
      'subagent-lost',
      expect.objectContaining({ failure_reason: 'container_lost' }),
    );
  });

  it('does not reap a workflow_step with a lost container while a sibling subagent is live in the same run', async () => {
    const workflowRunId = 'run-with-live-child';
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'step-with-live-child',
          kind: 'workflow_step',
          workflow_run_id: workflowRunId,
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: null,
          container_id: 'parent-container',
        },
      ]),
      // Returns a live subagent for this run — simulating a fire-and-poll child
      findNonTerminalSubagentsByRun: vi
        .fn()
        .mockResolvedValue([{ id: 'child-subagent', state: 'running' }]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(true) };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      undefined,
    );

    const clock = { value: 0 };
    (service as unknown as { now: () => number }).now = () => clock.value;

    // First sweep — container first observed lost; no reap regardless.
    await service.sweepOnce();
    expect(publisher.reaped).not.toHaveBeenCalled();

    // Advance past the grace window; still should NOT reap due to live child.
    clock.value = 100_000; // > DEFAULT_CONTAINER_LOST_GRACE_MS (90_000)
    await service.sweepOnce();

    expect(publisher.reaped).not.toHaveBeenCalled();
  });
});

describe('ExecutionSupervisorService shutdown gate', () => {
  it('skips the sweep entirely when the API is shutting down', async () => {
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn() };
    const docker = { isContainerLost: vi.fn() };
    const shutdownState = makeShutdownState(true);
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      shutdownState,
      undefined,
      undefined,
    );

    await service.sweepOnce();

    expect(repo.findNonTerminal).not.toHaveBeenCalled();
  });
});

describe('ExecutionSupervisorService freeze awareness', () => {
  it('never reaps frozen executions and stands down while not RUNNING', async () => {
    const lifecycle = new ServiceLifecycleStateService(); // booting
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn() };
    const probe = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const svc = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      probe,
      lifecycle,
      makeShutdownState(),
      undefined,
      undefined,
    );
    await svc.sweepOnce();
    // Suspended while booting: it should not even query.
    expect(repo.findNonTerminal).not.toHaveBeenCalled();

    lifecycle.markRunning();
    repo.findNonTerminal.mockResolvedValue([
      {
        id: 'f',
        kind: 'workflow_chat',
        state: 'running',
        frozen: true,
        created_at: new Date(0),
        last_heartbeat_at: new Date(0),
        container_id: 'c',
      },
    ]);
    await svc.sweepOnce();
    expect(publisher.reaped).not.toHaveBeenCalled();
  });
});

describe('ExecutionSupervisorService.sweepOnce — reconcile finished-but-running steps', () => {
  it('calls publisher.completed (not reaped) when agent ended past the grace window and container is alive', async () => {
    const workflowRunId = 'run-reconcile-1';
    const jobId = 'job-reconcile-1';
    const now = RECONCILE_GRACE_MS + 10_000;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-reconcile-1',
          kind: 'workflow_step',
          workflow_run_id: workflowRunId,
          context_id: jobId,
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: null,
          container_id: 'c-alive',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = {
      reaped: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
    };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    // Reader returns a signal older than RECONCILE_GRACE_MS
    const agentEndSignalReader = {
      findLatest: vi.fn().mockResolvedValue({
        endedAtMs: now - RECONCILE_GRACE_MS,
        outcome: 'success',
      }),
    };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      agentEndSignalReader as never,
      undefined,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(publisher.completed).toHaveBeenCalledOnce();
    expect(publisher.completed).toHaveBeenCalledWith('exec-reconcile-1');
    expect(publisher.reaped).not.toHaveBeenCalled();
  });

  it('calls publisher.failed (not completed) when agent ended in FAILURE past the grace window', async () => {
    const workflowRunId = 'run-reconcile-fail';
    const jobId = 'job-reconcile-fail';
    const now = RECONCILE_GRACE_MS + 10_000;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-reconcile-fail',
          kind: 'workflow_step',
          workflow_run_id: workflowRunId,
          context_id: jobId,
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: null,
          container_id: 'c-alive-fail',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = {
      reaped: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
    };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    // Reader returns a FAILURE signal older than RECONCILE_GRACE_MS
    const agentEndSignalReader = {
      findLatest: vi.fn().mockResolvedValue({
        endedAtMs: now - RECONCILE_GRACE_MS,
        outcome: 'failure',
      }),
    };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      agentEndSignalReader as never,
      undefined,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(publisher.failed).toHaveBeenCalledOnce();
    expect(publisher.failed).toHaveBeenCalledWith(
      'exec-reconcile-fail',
      expect.objectContaining({ failure_reason: 'agent_error' }),
    );
    expect(publisher.completed).not.toHaveBeenCalled();
    expect(publisher.reaped).not.toHaveBeenCalled();
  });

  it('does not reconcile when the reader returns null (agent not yet ended)', async () => {
    const workflowRunId = 'run-reconcile-2';
    const jobId = 'job-reconcile-2';
    const now = RECONCILE_GRACE_MS + 10_000;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-reconcile-2',
          kind: 'workflow_step',
          workflow_run_id: workflowRunId,
          context_id: jobId,
          state: 'running',
          created_at: new Date(now - 1000),
          last_heartbeat_at: null,
          container_id: 'c-alive-2',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = {
      reaped: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
    };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const agentEndSignalReader = {
      findLatest: vi.fn().mockResolvedValue(null),
    };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      agentEndSignalReader as never,
      undefined,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(publisher.completed).not.toHaveBeenCalled();
    expect(publisher.reaped).not.toHaveBeenCalled();
  });

  it('does not query the reader for non-workflow_step rows', async () => {
    const now = RECONCILE_GRACE_MS + 10_000;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-subagent',
          kind: 'subagent',
          workflow_run_id: 'run-x',
          context_id: 'job-x',
          state: 'running',
          created_at: new Date(now - 1000),
          last_heartbeat_at: new Date(now - 1000),
          container_id: 'c-sub',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = {
      reaped: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
    };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const agentEndSignalReader = {
      findLatest: vi.fn().mockResolvedValue(null),
    };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      agentEndSignalReader as never,
      undefined,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(agentEndSignalReader.findLatest).not.toHaveBeenCalled();
  });

  it('reaps via max_runtime_exceeded even if agent ended past grace', async () => {
    const workflowRunId = 'run-reconcile-3';
    const jobId = 'job-reconcile-3';
    const now = 5 * 60 * 60_000; // > DEFAULT_MAX_RUNTIME_MS (4h)
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-reconcile-3',
          kind: 'workflow_step',
          workflow_run_id: workflowRunId,
          context_id: jobId,
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: null,
          container_id: 'c-alive-3',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = {
      reaped: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
    };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const agentEndSignalReader = {
      findLatest: vi.fn().mockResolvedValue({
        endedAtMs: now - RECONCILE_GRACE_MS,
        outcome: 'success',
      }),
    };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      agentEndSignalReader as never,
      undefined,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(publisher.reaped).toHaveBeenCalledOnce();
    expect(publisher.reaped).toHaveBeenCalledWith(
      'exec-reconcile-3',
      expect.objectContaining({ failure_reason: 'max_runtime_exceeded' }),
    );
    expect(publisher.completed).not.toHaveBeenCalled();
  });

  it('reconciles to completed from durable output when the agent-end signal was lost', async () => {
    const workflowRunId = 'run-durable-1';
    const jobId = 'job-durable-1';
    const now = DURABLE_OUTPUT_QUIESCENCE_MS + 10 * 60_000;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-durable-1',
          kind: 'workflow_step',
          workflow_run_id: workflowRunId,
          context_id: jobId,
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: null,
          container_id: 'c-alive-durable',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = {
      reaped: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
    };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    // No agent-end telemetry signal survived the crash...
    const agentEndSignalReader = {
      findLatest: vi.fn().mockResolvedValue(null),
    };
    // ...but the durable output was persisted and the job has gone quiescent.
    const jobOutputReader = {
      findCompletionCandidate: vi.fn().mockResolvedValue({
        outputPersistedAtMs: now - DURABLE_OUTPUT_QUIESCENCE_MS,
        latestActivityMs: now - DURABLE_OUTPUT_QUIESCENCE_MS,
      }),
    };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      agentEndSignalReader as never,
      undefined,
      jobOutputReader as never,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(jobOutputReader.findCompletionCandidate).toHaveBeenCalledWith(
      workflowRunId,
      jobId,
    );
    expect(publisher.completed).toHaveBeenCalledOnce();
    expect(publisher.completed).toHaveBeenCalledWith('exec-durable-1');
    expect(publisher.reaped).not.toHaveBeenCalled();
  });

  it('does not reconcile from durable output while the job is still active (not quiescent)', async () => {
    const workflowRunId = 'run-durable-2';
    const jobId = 'job-durable-2';
    const now = DURABLE_OUTPUT_QUIESCENCE_MS + 10 * 60_000;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-durable-2',
          kind: 'workflow_step',
          workflow_run_id: workflowRunId,
          context_id: jobId,
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: null,
          container_id: 'c-alive-durable-2',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = {
      reaped: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
    };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const agentEndSignalReader = {
      findLatest: vi.fn().mockResolvedValue(null),
    };
    // Output persisted, but the latest activity is recent → still within window.
    const jobOutputReader = {
      findCompletionCandidate: vi.fn().mockResolvedValue({
        outputPersistedAtMs: now - 30 * 60_000,
        latestActivityMs: now - 1_000,
      }),
    };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      agentEndSignalReader as never,
      undefined,
      jobOutputReader as never,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(publisher.completed).not.toHaveBeenCalled();
    expect(publisher.reaped).not.toHaveBeenCalled();
  });

  it('reaps a running workflow_step when its owner lease expired and job activity is quiescent', async () => {
    const workflowRunId = 'run-lease-orphan';
    const jobId = 'job-lease-orphan';
    const now = Date.parse('2026-06-30T12:10:00.000Z');
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-lease-orphan',
          kind: 'workflow_step',
          workflow_run_id: workflowRunId,
          context_id: jobId,
          state: 'running',
          created_at: new Date(now - 10 * 60_000),
          last_heartbeat_at: null,
          container_id: 'c-alive-lease-orphan',
          owner_lease_expires_at: new Date(
            now - WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS,
          ),
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = {
      reaped: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
    };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const agentEndSignalReader = {
      findLatest: vi.fn().mockResolvedValue(null),
    };
    const jobOutputReader = {
      findCompletionCandidate: vi.fn().mockResolvedValue(null),
      findLatestJobActivity: vi.fn().mockResolvedValue({
        latestActivityMs: now - WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS,
      }),
    };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      agentEndSignalReader as never,
      undefined,
      jobOutputReader as never,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(jobOutputReader.findLatestJobActivity).toHaveBeenCalledWith(
      workflowRunId,
      jobId,
    );
    expect(publisher.reaped).toHaveBeenCalledWith(
      'exec-lease-orphan',
      expect.objectContaining({ failure_reason: 'idle_timeout' }),
    );
    expect(publisher.completed).not.toHaveBeenCalled();
  });

  it('reaps a running workflow_step when its owner lease expired and no job activity exists', async () => {
    const workflowRunId = 'run-no-activity-orphan';
    const jobId = 'job-no-activity-orphan';
    const now = Date.parse('2026-06-30T12:10:00.000Z');
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-no-activity-orphan',
          kind: 'workflow_step',
          workflow_run_id: workflowRunId,
          context_id: jobId,
          state: 'running',
          created_at: new Date(now - 10 * 60_000),
          last_heartbeat_at: null,
          container_id: 'c-alive-no-activity-orphan',
          owner_lease_expires_at: new Date(
            now - WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS,
          ),
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = {
      reaped: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
    };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const agentEndSignalReader = {
      findLatest: vi.fn().mockResolvedValue(null),
    };
    const jobOutputReader = {
      findCompletionCandidate: vi.fn().mockResolvedValue(null),
      findLatestJobActivity: vi.fn().mockResolvedValue(null),
    };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      agentEndSignalReader as never,
      undefined,
      jobOutputReader as never,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(jobOutputReader.findLatestJobActivity).toHaveBeenCalledWith(
      workflowRunId,
      jobId,
    );
    expect(publisher.reaped).toHaveBeenCalledWith(
      'exec-no-activity-orphan',
      expect.objectContaining({ failure_reason: 'idle_timeout' }),
    );
    expect(publisher.completed).not.toHaveBeenCalled();
  });
});

describe('ExecutionSupervisorService.sweepOnce — checkpoint persistence on reap', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_CHECKPOINT_RESUME_ENABLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('records a checkpoint row when a workflow_step execution with a sidecar marker is reaped', async () => {
    // Arrange: write a sidecar JSONL with a valid checkpoint marker
    const baseDir = await mkdtemp(join(tmpdir(), 'sv-ck-'));
    const workflowRunId = 'run-ck-1';
    const jobId = 'job-ck-1';
    const sidecarPath = checkpointSidecarHostPath(
      baseDir,
      workflowRunId,
      jobId,
    );
    mkdirSync(dirname(sidecarPath), { recursive: true });
    await writeFile(
      sidecarPath,
      JSON.stringify({
        engine: 'claude-code',
        phase: 'result',
        callSeq: 3,
        toolName: 'http.post',
        sessionRef: { kind: 'claude_code', sessionId: 'sess-abc' },
      }) + '\n',
    );

    const now = 5 * 60 * 60_000; // > 4h max_runtime: forces a reap regardless of the container-lost grace window
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-ck-1',
          kind: 'workflow_step',
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: new Date(0),
          container_id: 'c-ck-1',
          workflow_run_id: workflowRunId,
          context_id: jobId,
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(true) };
    const checkpointRepo = { record: vi.fn().mockResolvedValue(undefined) };
    const sessionHydration = {
      findSessionTreeByWorkflowRunId: vi.fn().mockResolvedValue(null),
    };

    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      {
        checkpointRepo: checkpointRepo as never,
        sessionHydration: sessionHydration as never,
      },
    );
    // Override base dir resolution so the helper finds our temp sidecar
    vi.stubEnv('NEXUS_CHECKPOINT_BASE_DIR', baseDir);
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    vi.unstubAllEnvs();

    expect(publisher.reaped).toHaveBeenCalledOnce();
    expect(checkpointRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'exec-ck-1',
        workflowRunId,
        stepId: jobId,
        engine: 'claude-code',
        phase: 'result',
        callSeq: 3,
        toolName: 'http.post',
        sessionRef: { kind: 'claude_code', sessionId: 'sess-abc' },
      }),
    );
  });

  it('reads the host session.jsonl and persists it fresh for pi-engine markers instead of using findSessionTreeByWorkflowRunId', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'sv-pi-'));
    const workflowRunId = 'run-pi-1';
    const jobId = 'job-pi-1';
    const sidecarPath = checkpointSidecarHostPath(
      baseDir,
      workflowRunId,
      jobId,
    );
    mkdirSync(dirname(sidecarPath), { recursive: true });
    await writeFile(
      sidecarPath,
      JSON.stringify({
        engine: 'pi',
        phase: 'intent',
        callSeq: 7,
        toolName: 'fs.write',
        // sessionRef is null — the runtime layer cannot see the PI tree id
        sessionRef: null,
        resumeNodeId: 'node-42',
      }) + '\n',
    );

    // Also write the session.jsonl in the sidecar dir (what the PI engine writes during the run)
    const sidecarDir = dirname(sidecarPath);
    const sessionJsonlPath = join(sidecarDir, 'session.jsonl');
    const freshSessionContent = [
      JSON.stringify({ id: 'root', type: 'root', parentId: null }),
      JSON.stringify({ id: 'turn1', type: 'user', parentId: 'root' }),
    ].join('\n');
    await writeFile(sessionJsonlPath, freshSessionContent);

    const now = 5 * 60 * 60_000; // > 4h max_runtime: forces a reap regardless of the container-lost grace window
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-pi-1',
          kind: 'workflow_step',
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: new Date(0),
          container_id: 'c-pi-1',
          workflow_run_id: workflowRunId,
          context_id: jobId,
          // HEAVY (2) — the real tier for PI workflow-step executions
          container_tier: 2,
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(true) };
    const checkpointRepo = { record: vi.fn().mockResolvedValue(undefined) };
    const sessionHydration = {
      findSessionTreeByWorkflowRunId: vi.fn(), // must NOT be called for pi reap
      saveSessionFromJsonl: vi.fn().mockResolvedValue('fresh-tree-from-host'),
    };

    vi.stubEnv('NEXUS_CHECKPOINT_BASE_DIR', baseDir);
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      {
        checkpointRepo: checkpointRepo as never,
        sessionHydration: sessionHydration as never,
      },
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    vi.unstubAllEnvs();

    // Must call saveSessionFromJsonl with the host file content, not findSessionTreeByWorkflowRunId
    expect(
      sessionHydration.findSessionTreeByWorkflowRunId,
    ).not.toHaveBeenCalled();
    // Must forward the execution row's container_tier so the stored tree uses
    // the correct tier (HEAVY=2 for PI workflow-step executions).
    expect(sessionHydration.saveSessionFromJsonl).toHaveBeenCalledWith(
      freshSessionContent,
      { workflow_run_id: workflowRunId },
      { containerTier: 2 },
    );
    expect(checkpointRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'exec-pi-1',
        engine: 'pi',
        callSeq: 7,
        resumeNodeId: 'node-42',
        // Must use the FRESH treeId from saveSessionFromJsonl
        sessionRef: { kind: 'pi', treeId: 'fresh-tree-from-host' },
      }),
    );
  });

  it('reads the host session.jsonl and persists it fresh for claude-code-engine markers', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'sv-cc-'));
    const workflowRunId = 'run-cc-1';
    const jobId = 'job-cc-1';
    const sidecarPath = checkpointSidecarHostPath(
      baseDir,
      workflowRunId,
      jobId,
    );
    mkdirSync(dirname(sidecarPath), { recursive: true });
    await writeFile(
      sidecarPath,
      JSON.stringify({
        engine: 'claude-code',
        phase: 'intent',
        callSeq: 3,
        toolName: 'fs.write',
        sessionRef: null,
        resumeNodeId: 'node-7',
      }) + '\n',
    );

    const sidecarDir = dirname(sidecarPath);
    const sessionJsonlPath = join(sidecarDir, 'session.jsonl');
    const freshSessionContent = [
      JSON.stringify({ id: 'root', type: 'session', parentId: null }),
      JSON.stringify({ id: 'turn1', type: 'message', parentId: 'root' }),
    ].join('\n');
    await writeFile(sessionJsonlPath, freshSessionContent);

    const now = 5 * 60 * 60_000; // > 4h max_runtime: forces a reap
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-cc-1',
          kind: 'workflow_step',
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: new Date(0),
          container_id: 'c-cc-1',
          workflow_run_id: workflowRunId,
          context_id: jobId,
          container_tier: 2,
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(true) };
    const checkpointRepo = { record: vi.fn().mockResolvedValue(undefined) };
    const sessionHydration = {
      findSessionTreeByWorkflowRunId: vi.fn(),
      saveSessionFromJsonl: vi.fn().mockResolvedValue('fresh-cc-tree'),
    };

    vi.stubEnv('NEXUS_CHECKPOINT_BASE_DIR', baseDir);
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      {
        checkpointRepo: checkpointRepo as never,
        sessionHydration: sessionHydration as never,
      },
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    vi.unstubAllEnvs();

    expect(
      sessionHydration.findSessionTreeByWorkflowRunId,
    ).not.toHaveBeenCalled();
    expect(sessionHydration.saveSessionFromJsonl).toHaveBeenCalledWith(
      freshSessionContent,
      { workflow_run_id: workflowRunId },
      { containerTier: 2 },
    );
    expect(checkpointRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'exec-cc-1',
        engine: 'claude-code',
        callSeq: 3,
        resumeNodeId: 'node-7',
        // The reaped claude-code session is a pi-compatible v3 tree, so the
        // persisted artifact is referenced as a `pi` tree; the originating
        // engine is preserved separately via the `engine` field.
        sessionRef: { kind: 'pi', treeId: 'fresh-cc-tree' },
      }),
    );
  });

  it('leaves sessionRef null and still records checkpoint when pi session.jsonl is absent', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'sv-pi-nosess-'));
    const workflowRunId = 'run-pi-nosess';
    const jobId = 'job-pi-nosess';
    const sidecarPath = checkpointSidecarHostPath(
      baseDir,
      workflowRunId,
      jobId,
    );
    mkdirSync(dirname(sidecarPath), { recursive: true });
    await writeFile(
      sidecarPath,
      JSON.stringify({
        engine: 'pi',
        phase: 'intent',
        callSeq: 2,
        sessionRef: null,
      }) + '\n',
    );
    // Intentionally do NOT create session.jsonl

    const now = 5 * 60 * 60_000; // > 4h max_runtime: forces a reap regardless of the container-lost grace window
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-pi-nosess',
          kind: 'workflow_step',
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: new Date(0),
          container_id: 'c-pi-nosess',
          workflow_run_id: workflowRunId,
          context_id: jobId,
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(true) };
    const checkpointRepo = { record: vi.fn().mockResolvedValue(undefined) };
    const sessionHydration = {
      findSessionTreeByWorkflowRunId: vi.fn(),
      saveSessionFromJsonl: vi.fn(),
    };

    vi.stubEnv('NEXUS_CHECKPOINT_BASE_DIR', baseDir);
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      {
        checkpointRepo: checkpointRepo as never,
        sessionHydration: sessionHydration as never,
      },
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    vi.unstubAllEnvs();

    expect(sessionHydration.saveSessionFromJsonl).not.toHaveBeenCalled();
    expect(checkpointRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'exec-pi-nosess',
        engine: 'pi',
        // sessionRef must be null — best-effort, not throwing
        sessionRef: null,
      }),
    );
  });

  it('does not call checkpointRepo when no checkpointDeps are configured', async () => {
    const now = 5 * 60 * 60_000; // > 4h max_runtime: forces a reap regardless of the container-lost grace window
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-nodeps',
          kind: 'workflow_step',
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: new Date(0),
          container_id: 'c-nodeps',
          workflow_run_id: 'run-nodeps',
          context_id: 'job-nodeps',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(true) };

    // No checkpointDeps — simulates the pre-wiring state
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      undefined,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    // Should still reap; just no checkpoint recorded
    expect(publisher.reaped).toHaveBeenCalledOnce();
  });

  it('does not call checkpointRepo when SESSION_CHECKPOINT_RESUME_ENABLED is off, even with deps wired', async () => {
    // Override the describe-level stub: turn the flag OFF for this test
    vi.stubEnv('SESSION_CHECKPOINT_RESUME_ENABLED', 'false');

    const now = 5 * 60 * 60_000; // > 4h max_runtime: forces a reap regardless of the container-lost grace window
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: 'exec-flagoff',
          kind: 'workflow_step',
          state: 'running',
          created_at: new Date(0),
          last_heartbeat_at: new Date(0),
          container_id: 'c-flagoff',
          workflow_run_id: 'run-flagoff',
          context_id: 'job-flagoff',
        },
      ]),
      findNonTerminalSubagentsByRun: vi.fn().mockResolvedValue([]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(true) };
    const checkpointRepo = { record: vi.fn().mockResolvedValue(undefined) };
    const sessionHydration = {
      saveSessionFromJsonl: vi.fn(),
    };

    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker,
      makeRunningLifecycle(),
      makeShutdownState(),
      undefined,
      {
        checkpointRepo: checkpointRepo as never,
        sessionHydration: sessionHydration as never,
      },
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    // Reap must still happen; but checkpoint must be skipped
    expect(publisher.reaped).toHaveBeenCalledOnce();
    expect(checkpointRepo.record).not.toHaveBeenCalled();
  });
});
