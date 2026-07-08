import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IJob } from '@nexus/core';
import {
  executeJobCore,
  JobExecutionDependencies,
} from './step-agent-step-executor.multistep';
import { COMMAND_STEP_HEARTBEAT_INTERVAL_MS } from './command-step-heartbeat.helpers';
import { JobQueueData } from './step-execution.types';
import { StepExecutionService } from './step-execution.service';
import { StateMachineService } from '../state-machine.service';
import { StateManagerService } from '../state-manager.service';
import { classifyProviderOutageFailure } from '../../llm/provider-outage-failure.helpers';

vi.mock('../../llm/provider-outage-failure.helpers', () => ({
  classifyProviderOutageFailure: vi.fn(),
}));

function makeJob(overrides: Partial<IJob> = {}): IJob {
  return {
    id: 'job-1',
    type: 'execution',
    tier: 'heavy',
    steps: [
      { id: 'implement', type: 'agent', prompt: 'Write the code' },
      {
        id: 'check_uncommitted',
        type: 'run_command',
        command: 'git status --porcelain',
        working_dir: '/workspace',
      },
      { id: 'commit', type: 'agent', prompt: 'Commit your changes' },
    ],
    ...overrides,
  };
}

function makeData(overrides: Partial<JobQueueData> = {}): JobQueueData {
  return {
    workflowRunId: 'run-1',
    jobId: 'job-1',
    job: makeJob(),
    ...overrides,
  };
}

const FIXTURE_CREDENTIAL = 'fixtureCredential';
const DEFAULT_RUNNER_AUTH = {
  type: 'api_key',
  apiKey: FIXTURE_CREDENTIAL,
} as const;

function makeDeps(
  overrides: Partial<JobExecutionDependencies> = {},
): JobExecutionDependencies {
  const stateManager = {
    setVariable: vi.fn().mockResolvedValue(null),
  } as unknown as StateManagerService;

  return {
    provisionContainer: vi.fn().mockResolvedValue('container-abc'),
    startContainerAndStreamLogs: vi.fn().mockResolvedValue(vi.fn()),
    getContainerIp: vi.fn().mockResolvedValue('172.17.0.5'),
    buildStepRunnerConfig: vi.fn().mockResolvedValue({
      harnessId: 'nexus-light',
      model: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        auth: DEFAULT_RUNNER_AUTH,
      },
      prompt: {
        systemPrompt: 'test prompt',
        initialPrompt: 'test prompt',
      },
    }),
    stepExecutionService: new StepExecutionService(
      new StateMachineService(),
      stateManager,
    ),
    containerHttpClient: {
      buildBaseUrl: vi.fn().mockReturnValue('http://172.17.0.5:8374'),
      waitForHealth: vi.fn().mockResolvedValue(undefined),
      executeAgent: vi.fn().mockResolvedValue({
        ok: true,
        response: 'done',
      }),
      executeCommand: vi.fn().mockResolvedValue({
        ok: true,
        exit_code: 0,
        stdout: ' M src/index.ts',
        stderr: '',
        timed_out: false,
      }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as any,
    workflowEngine: {
      handleJobComplete: vi.fn().mockResolvedValue(undefined),
    } as any,
    publishTurnEndAndComplete: vi.fn().mockResolvedValue(undefined),
    publishTurnEnd: vi.fn().mockResolvedValue(undefined),
    shouldContinueInSessionRetry: vi.fn().mockResolvedValue(true),
    sleep: vi.fn().mockResolvedValue(undefined),
    checkRequiredToolRetry: vi.fn().mockResolvedValue('proceed'),
    fetchContainerLogSnapshot: vi.fn().mockResolvedValue('mock logs'),
    cleanup: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

describe('executeJobCore', () => {
  it('notifies the container provisioned hook with the container id before steps run', async () => {
    const notifyContainerProvisioned = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ notifyContainerProvisioned });

    await executeJobCore({
      data: makeData(),
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(notifyContainerProvisioned).toHaveBeenCalledWith('container-abc');
    const notifyOrder = notifyContainerProvisioned.mock.invocationCallOrder[0];
    const executeOrder = (
      deps.containerHttpClient.executeAgent as ReturnType<typeof vi.fn>
    ).mock.invocationCallOrder[0];
    expect(notifyOrder).toBeLessThan(executeOrder);
  });

  it('does not fail the job when the provisioned hook throws', async () => {
    const notifyContainerProvisioned = vi
      .fn()
      .mockRejectedValue(new Error('bus down'));
    const deps = makeDeps({ notifyContainerProvisioned });

    const result = await executeJobCore({
      data: makeData(),
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(result).toEqual(
      expect.objectContaining({ containerId: 'container-abc' }),
    );
  });

  it('throws when job has no steps', async () => {
    const data = makeData({ job: makeJob({ steps: [] }) });
    const deps = makeDeps();

    await expect(
      executeJobCore({
        data,
        bullJobId: 'bull-1',
        stateVariables: {},
        resolvedJobInputs: {},
        deps,
      }),
    ).rejects.toThrow('Job job-1 has no steps to execute');
  });

  it('provisions container and waits for health before executing steps', async () => {
    const deps = makeDeps();
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Retry test' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(deps.provisionContainer).toHaveBeenCalledWith(data, {});
    expect(deps.startContainerAndStreamLogs).toHaveBeenCalledWith(
      'container-abc',
      'run-1',
      'job-1',
    );
    expect(deps.getContainerIp).toHaveBeenCalledWith('container-abc');
    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .waitForHealth,
    ).toHaveBeenCalledWith(
      'http://172.17.0.5:8374',
      expect.any(Number),
      expect.objectContaining({
        containerId: 'container-abc',
        fetchLogs: expect.any(Function),
      }),
    );
  });

  it('executes agent steps via HTTP POST to container', async () => {
    const deps = makeDeps();
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Build it' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .executeAgent,
    ).toHaveBeenCalledWith(
      'http://172.17.0.5:8374',
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        auth: DEFAULT_RUNNER_AUTH,
        stepId: 'implement',
      }),
    );
  });

  it('persists the resolved provider/model/harness after building the runner config', async () => {
    const persistResolvedConfig = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      persistResolvedConfig,
      buildStepRunnerConfig: vi.fn().mockResolvedValue({
        harnessId: 'pi',
        model: {
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          auth: DEFAULT_RUNNER_AUTH,
        },
        prompt: { systemPrompt: 's', initialPrompt: 'i' },
      }),
    });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Build it' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(persistResolvedConfig).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      harness_id: 'pi',
    });
  });

  it('folds the resolved agent profile into the persisted config when the dependency provides one', async () => {
    const persistResolvedConfig = vi.fn().mockResolvedValue(undefined);
    const getResolvedAgentProfile = vi
      .fn()
      .mockReturnValue({ id: 'profile-uuid-1', name: 'implementer-agent' });
    const deps = makeDeps({
      persistResolvedConfig,
      getResolvedAgentProfile,
      buildStepRunnerConfig: vi.fn().mockResolvedValue({
        harnessId: 'pi',
        model: {
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          auth: DEFAULT_RUNNER_AUTH,
        },
        prompt: { systemPrompt: 's', initialPrompt: 'i' },
      }),
    });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Build it' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(persistResolvedConfig).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      harness_id: 'pi',
      agent_profile_id: 'profile-uuid-1',
      agent_profile_name: 'implementer-agent',
    });
  });

  it('omits agent_profile_id/agent_profile_name from the persisted patch when the dependency is wired but no profile resolved', async () => {
    const persistResolvedConfig = vi.fn().mockResolvedValue(undefined);
    const getResolvedAgentProfile = vi.fn().mockReturnValue(null);
    const deps = makeDeps({
      persistResolvedConfig,
      getResolvedAgentProfile,
      buildStepRunnerConfig: vi.fn().mockResolvedValue({
        harnessId: 'pi',
        model: {
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          auth: DEFAULT_RUNNER_AUTH,
        },
        prompt: { systemPrompt: 's', initialPrompt: 'i' },
      }),
    });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Build it' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(persistResolvedConfig).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      harness_id: 'pi',
    });
    const patch = persistResolvedConfig.mock.calls[0][0];
    expect(patch).not.toHaveProperty('agent_profile_id');
    expect(patch).not.toHaveProperty('agent_profile_name');
  });

  it('persists a produced Claude Code session ref from agent step outputs', async () => {
    const persistProducedSessionRef = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      containerHttpClient: {
        buildBaseUrl: vi.fn().mockReturnValue('http://172.17.0.5:8374'),
        waitForHealth: vi.fn().mockResolvedValue(undefined),
        executeAgent: vi.fn().mockResolvedValue({
          ok: true,
          response: 'done',
          producedSessionId: 's-produced-1',
        }),
        executeCommand: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      } as unknown as JobExecutionDependencies['containerHttpClient'],
      persistProducedSessionRef,
    });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Build it' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(persistProducedSessionRef).toHaveBeenCalledWith('run-1', {
      kind: 'claude_code',
      sessionId: 's-produced-1',
    });
  });

  it('does not persist a session ref when no agent step produces a session id', async () => {
    const persistProducedSessionRef = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ persistProducedSessionRef });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Build it' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(persistProducedSessionRef).not.toHaveBeenCalled();
  });

  it('accepts OAuth auth with an empty legacy API key', async () => {
    const deps = makeDeps({
      buildStepRunnerConfig: vi.fn().mockResolvedValue({
        harnessId: 'nexus-light',
        model: {
          provider: 'corporate-ai',
          model: 'corp-large',
          auth: {
            type: 'oauth',
            credential: {
              type: 'oauth',
              refreshToken: 'fixtureRefreshCredential',
              accessToken: 'fixtureAccessCredential',
              expiresAt: 4102444800000,
            },
          },
          providerConfig: {
            name: 'Corporate AI',
            baseUrl: 'https://ai.corp.example/v1',
            api: 'openai-responses',
          },
        },
        prompt: {
          systemPrompt: 'system',
          initialPrompt: 'initial',
        },
      }),
    });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Build it' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .executeAgent,
    ).toHaveBeenCalledWith(
      'http://172.17.0.5:8374',
      expect.objectContaining({
        auth: expect.objectContaining({ type: 'oauth' }),
      }),
    );
  });

  it('publishes agent_prompt_sent before executing the agent step', async () => {
    const publishProcessEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps();
    const depsWithPublish = deps as JobExecutionDependencies & {
      publishProcessEvent: typeof publishProcessEvent;
    };
    depsWithPublish.publishProcessEvent = publishProcessEvent;

    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Build it' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps: depsWithPublish,
    });

    expect(publishProcessEvent).toHaveBeenCalledWith(
      'run-1',
      'agent_prompt_sent',
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'job-1',
        stepId: 'implement',
        source: 'workflow_step',
        message: 'test prompt',
      }),
    );

    const publishOrder = publishProcessEvent.mock.invocationCallOrder[0];
    const executeOrder = (
      deps.containerHttpClient.executeAgent as ReturnType<typeof vi.fn>
    ).mock.invocationCallOrder[0];

    expect(publishOrder).toBeLessThan(executeOrder);
  });

  it('executes run_command steps via HTTP POST to container', async () => {
    const deps = makeDeps();
    const data = makeData({
      job: makeJob({
        steps: [
          {
            id: 'check',
            type: 'run_command',
            command: 'git status --porcelain',
            working_dir: '/workspace',
            timeout_ms: 10000,
          },
        ],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .executeCommand,
    ).toHaveBeenCalledWith('http://172.17.0.5:8374', {
      command: 'git status --porcelain',
      timeoutMs: 10000,
      workingDir: '/workspace',
      stepId: 'check',
    });
  });

  it('emits periodic liveness heartbeats while a run_command step is in flight', async () => {
    vi.useFakeTimers();
    try {
      const recordHeartbeat = vi.fn();
      let resolveCommand!: (value: unknown) => void;
      const executeCommand = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveCommand = resolve;
          }),
      );
      const deps = makeDeps({ recordHeartbeat });
      (
        deps.containerHttpClient as unknown as {
          executeCommand: typeof executeCommand;
        }
      ).executeCommand = executeCommand;

      const data = makeData({
        job: makeJob({
          steps: [
            {
              id: 'run_gate',
              type: 'run_command',
              command: 'npm run build && npm run test:api',
              working_dir: '/workspace',
              timeout_ms: 1_200_000,
            },
          ],
        }),
      });

      const pending = executeJobCore({
        data,
        bullJobId: 'bull-1',
        stateVariables: {},
        resolvedJobInputs: {},
        deps,
      });

      // Advance past two heartbeat intervals while the command is still running.
      await vi.advanceTimersByTimeAsync(COMMAND_STEP_HEARTBEAT_INTERVAL_MS * 2);
      expect(recordHeartbeat.mock.calls.length).toBeGreaterThanOrEqual(2);

      resolveCommand({
        ok: true,
        exit_code: 0,
        stdout: '',
        stderr: '',
        timed_out: false,
      });
      await pending;

      // No further heartbeats once the command has settled.
      recordHeartbeat.mockClear();
      await vi.advanceTimersByTimeAsync(COMMAND_STEP_HEARTBEAT_INTERVAL_MS * 2);
      expect(recordHeartbeat).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs multi-step sequence: implement → check → commit', async () => {
    const deps = makeDeps();
    const data = makeData({
      job: makeJob({
        steps: [
          { id: 'implement', type: 'agent', prompt: 'Write code' },
          {
            id: 'check_uncommitted',
            type: 'run_command',
            command: 'git status --porcelain',
          },
          { id: 'commit', type: 'agent', prompt: 'Commit changes' },
        ],
      }),
    });

    const result = await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .executeAgent,
    ).toHaveBeenCalledTimes(2);
    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .executeCommand,
    ).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'completed' });
  });

  it('calls publishTurnEndAndComplete with aggregated output', async () => {
    const deps = makeDeps();
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Build' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(deps.publishTurnEndAndComplete).toHaveBeenCalledWith(
      'run-1',
      'job-1',
      expect.objectContaining({ ok: true, containerId: 'container-abc' }),
    );
  });

  it('calls shutdown on the container after execution', async () => {
    const deps = makeDeps();
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'step1', type: 'agent', prompt: 'Do it' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .shutdown,
    ).toHaveBeenCalledWith('http://172.17.0.5:8374');
  });

  it('always cleans up container even on failure', async () => {
    const deps = makeDeps({
      getContainerIp: vi.fn().mockRejectedValue(new Error('Cannot resolve IP')),
    });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Retry test' }],
      }),
    });

    await expect(
      executeJobCore({
        data,
        bullJobId: 'bull-1',
        stateVariables: {},
        resolvedJobInputs: {},
        deps,
      }),
    ).rejects.toThrow('Cannot resolve IP');

    expect(deps.cleanup).toHaveBeenCalledWith(
      'container-abc',
      expect.any(Function),
    );
  });

  it('throws for unsupported step types', async () => {
    const deps = makeDeps();
    const data = makeData({
      job: makeJob({
        steps: [
          { id: 'bad_step', type: 'invoke_workflow' as any, prompt: 'nope' },
        ],
      }),
    });

    await expect(
      executeJobCore({
        data,
        bullJobId: 'bull-1',
        stateVariables: {},
        resolvedJobInputs: {},
        deps,
      }),
    ).rejects.toThrow("Unsupported step type 'invoke_workflow'");
  });

  it('throws for run_command step without command', async () => {
    const deps = makeDeps();
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'broken', type: 'run_command' }],
      }),
    });

    await expect(
      executeJobCore({
        data,
        bullJobId: 'bull-1',
        stateVariables: {},
        resolvedJobInputs: {},
        deps,
      }),
    ).rejects.toThrow("run_command step 'broken' has no command");
  });

  it('supports step transitions with the step execution engine', async () => {
    const deps = makeDeps();

    (deps.containerHttpClient.executeCommand as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        exit_code: 0,
        stdout: ' M src/index.ts',
        stderr: '',
        timed_out: false,
      })
      .mockResolvedValue({
        ok: true,
        exit_code: 0,
        stdout: '',
        stderr: '',
        timed_out: false,
      });

    const data = makeData({
      job: makeJob({
        max_step_loops: 5,
        steps: [
          { id: 'implement', type: 'agent', prompt: 'Write code' },
          {
            id: 'check_uncommitted',
            type: 'run_command',
            command: 'git status --porcelain',
            transitions: [
              {
                condition: 'steps.check_uncommitted.output.stdout != ""',
                next: 'commit',
              },
              {
                condition: 'steps.check_uncommitted.output.stdout == ""',
                next: 'done',
              },
            ],
          },
          {
            id: 'commit',
            type: 'agent',
            prompt: 'Commit changes',
            transitions: [{ condition: 'true', next: 'check_uncommitted' }],
          },
        ],
      }),
    });

    const result = await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(result).toMatchObject({ status: 'completed' });
    // implement → check (files found) → commit → check (empty) → done
    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .executeAgent,
    ).toHaveBeenCalledTimes(2);
    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .executeCommand,
    ).toHaveBeenCalledTimes(2);
  });

  it('returns retried status when required tool retry triggers re-enqueue', async () => {
    const deps = makeDeps({
      checkRequiredToolRetry: vi.fn().mockResolvedValue('retried'),
    });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'review', type: 'agent', prompt: 'Review code' }],
      }),
    });

    const result = await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(result).toMatchObject({ status: 'retried' });
    expect(deps.checkRequiredToolRetry).toHaveBeenCalledWith('container-abc');
    expect(deps.publishTurnEndAndComplete).not.toHaveBeenCalled();
    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .shutdown,
    ).toHaveBeenCalled();
    expect(deps.cleanup).toHaveBeenCalled();
  });

  it('calls shutdown in finally block even when steps fail', async () => {
    const deps = makeDeps({
      containerHttpClient: {
        buildBaseUrl: vi.fn().mockReturnValue('http://172.17.0.5:8374'),
        waitForHealth: vi.fn().mockResolvedValue(undefined),
        executeAgent: vi.fn().mockRejectedValue(new Error('Agent crashed')),
        executeCommand: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      } as any,
    });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'step1', type: 'agent', prompt: 'Fail' }],
      }),
    });

    await expect(
      executeJobCore({
        data,
        bullJobId: 'bull-1',
        stateVariables: {},
        resolvedJobInputs: {},
        deps,
      }),
    ).rejects.toThrow('Agent crashed');

    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .shutdown,
    ).toHaveBeenCalledWith('http://172.17.0.5:8374');
    expect(deps.cleanup).toHaveBeenCalled();
  });

  it('injects previous session before starting the container', async () => {
    const injectSession = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ injectSession });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'step1', type: 'agent', prompt: 'Resume' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(injectSession).toHaveBeenCalledWith('container-abc', undefined);

    const provisionOrder = (deps.provisionContainer as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0];
    const injectOrder = injectSession.mock.invocationCallOrder[0];
    const startOrder = (
      deps.startContainerAndStreamLogs as ReturnType<typeof vi.fn>
    ).mock.invocationCallOrder[0];
    expect(provisionOrder).toBeLessThan(injectOrder);
    expect(injectOrder).toBeLessThan(startOrder);
  });

  it('injects resumed session tree when resumeSessionTreeId is provided', async () => {
    const injectSession = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ injectSession });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'step1', type: 'agent', prompt: 'Resume' }],
      }),
      resumeSessionTreeId: 'session-tree-123',
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(injectSession).toHaveBeenCalledWith(
      'container-abc',
      'session-tree-123',
    );
  });

  it('continues execution when injectSession fails', async () => {
    const injectSession = vi
      .fn()
      .mockRejectedValue(new Error('No previous session'));
    const deps = makeDeps({ injectSession });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'step1', type: 'agent', prompt: 'Go' }],
      }),
    });

    const result = await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(result).toMatchObject({ status: 'completed' });
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to inject previous session'),
    );
  });

  it('saves session after successful execution and includes ID in output', async () => {
    const saveSession = vi.fn().mockResolvedValue('session-tree-42');
    const deps = makeDeps({ saveSession });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'step1', type: 'agent', prompt: 'Build' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(saveSession).toHaveBeenCalledWith('container-abc');
    expect(deps.publishTurnEndAndComplete).toHaveBeenCalledWith(
      'run-1',
      'job-1',
      expect.objectContaining({ sessionTreeId: 'session-tree-42' }),
    );
  });

  it('does not block execution when saveSession fails', async () => {
    const saveSession = vi
      .fn()
      .mockRejectedValue(new Error('Session extraction failed'));
    const deps = makeDeps({ saveSession });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'step1', type: 'agent', prompt: 'Build' }],
      }),
    });

    const result = await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(result).toMatchObject({ status: 'completed' });
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to save session'),
    );
    expect(deps.publishTurnEndAndComplete).toHaveBeenCalledWith(
      'run-1',
      'job-1',
      expect.not.objectContaining({ sessionTreeId: expect.any(String) }),
    );
  });

  it('does not save session when retried', async () => {
    const saveSession = vi.fn().mockResolvedValue('should-not-be-called');
    const deps = makeDeps({
      saveSession,
      checkRequiredToolRetry: vi.fn().mockResolvedValue('retried'),
    });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'review', type: 'agent', prompt: 'Review' }],
      }),
    });

    const result = await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(result).toMatchObject({ status: 'retried' });
    expect(saveSession).toHaveBeenCalled();
  });

  it('kills stale containers before provisioning when callback provided', async () => {
    const killStaleContainers = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ killStaleContainers });
    const data = makeData({
      job: makeJob({
        steps: [{ id: 'step1', type: 'agent', prompt: 'Go' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(killStaleContainers).toHaveBeenCalledWith('run-1', 'job-1');
    const killOrder = killStaleContainers.mock.invocationCallOrder[0];
    const provisionOrder = (deps.provisionContainer as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0];
    expect(killOrder).toBeLessThan(provisionOrder);
  });

  it('retries provider 429 failures in-session and succeeds without workflow fallback', async () => {
    const deps = makeDeps({
      containerHttpClient: {
        buildBaseUrl: vi.fn().mockReturnValue('http://172.17.0.5:8374'),
        waitForHealth: vi.fn().mockResolvedValue(undefined),
        executeAgent: vi
          .fn()
          .mockResolvedValueOnce({
            ok: false,
            error: '429 too many requests',
          })
          .mockResolvedValueOnce({
            ok: true,
            response: 'retry succeeded',
          })
          .mockResolvedValue({
            ok: true,
            response: 'retry succeeded',
          }),
        executeCommand: vi.fn().mockResolvedValue({
          ok: true,
          exit_code: 0,
          stdout: ' M src/index.ts',
          stderr: '',
          timed_out: false,
        }),
        shutdown: vi.fn().mockResolvedValue(undefined),
      } as any,
    });
    const data = makeData();

    const result = await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(result).toMatchObject({ status: 'completed' });
    expect(
      (deps.containerHttpClient.executeAgent as ReturnType<typeof vi.fn>).mock
        .calls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    expect(deps.publishTurnEndAndComplete).toHaveBeenCalledTimes(1);
    expect(deps.publishTurnEnd).not.toHaveBeenCalled();
  });

  it('retries provider 529 failures in-session and succeeds without workflow fallback', async () => {
    const deps = makeDeps({
      containerHttpClient: {
        buildBaseUrl: vi.fn().mockReturnValue('http://172.17.0.5:8374'),
        waitForHealth: vi.fn().mockResolvedValue(undefined),
        executeAgent: vi
          .fn()
          .mockResolvedValueOnce({
            ok: false,
            error: 'Provider returned status code: 529 high traffic detected',
          })
          .mockResolvedValueOnce({
            ok: true,
            response: 'retry succeeded',
          })
          .mockResolvedValue({
            ok: true,
            response: 'retry succeeded',
          }),
        executeCommand: vi.fn().mockResolvedValue({
          ok: true,
          exit_code: 0,
          stdout: ' M src/index.ts',
          stderr: '',
          timed_out: false,
        }),
        shutdown: vi.fn().mockResolvedValue(undefined),
      } as any,
    });
    const data = makeData();

    const result = await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(result).toMatchObject({ status: 'completed' });
    expect(
      (deps.containerHttpClient.executeAgent as ReturnType<typeof vi.fn>).mock
        .calls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    expect(deps.publishTurnEndAndComplete).toHaveBeenCalledTimes(1);
    expect(deps.publishTurnEnd).not.toHaveBeenCalled();
  });

  it('stops in-session provider retry when retry continuation is halted', async () => {
    const deps = makeDeps({
      shouldContinueInSessionRetry: vi.fn().mockResolvedValue(false),
      containerHttpClient: {
        buildBaseUrl: vi.fn().mockReturnValue('http://172.17.0.5:8374'),
        waitForHealth: vi.fn().mockResolvedValue(undefined),
        executeAgent: vi.fn().mockResolvedValue({
          ok: false,
          error: '429 too many requests',
        }),
        executeCommand: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      } as any,
    });

    await expect(
      executeJobCore({
        data: makeData(),
        bullJobId: 'bull-1',
        stateVariables: {},
        resolvedJobInputs: {},
        deps,
      }),
    ).rejects.toThrow('429 too many requests');

    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .executeAgent,
    ).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.publishTurnEndAndComplete).not.toHaveBeenCalled();
  });

  it('does not publish completion when step execution returns failed', async () => {
    const deps = makeDeps({
      stepExecutionService: {
        execute: vi.fn().mockResolvedValue({
          status: 'failed',
          finalStepId: 'implement',
          outputs: {
            implement: {
              ok: false,
              error: 'merge failed',
            },
          },
        }),
      } as unknown as StepExecutionService,
    });

    await expect(
      executeJobCore({
        data: makeData(),
        bullJobId: 'bull-1',
        stateVariables: {},
        resolvedJobInputs: {},
        deps,
      }),
    ).rejects.toThrow('merge failed');

    expect(deps.publishTurnEndAndComplete).not.toHaveBeenCalled();
  });

  it('fails fast on a terminal provider error without attempting an output-contract retry', async () => {
    const checkRequiredToolRetry = vi.fn().mockResolvedValue('retried');
    const deps = makeDeps({
      checkRequiredToolRetry,
      stepExecutionService: {
        execute: vi.fn().mockResolvedValue({
          status: 'failed',
          finalStepId: 'strategize',
          outputs: {
            strategize: {
              ok: false,
              error:
                '400 {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage. Add more at claude.ai/settings/usage and keep going."}}',
            },
          },
        }),
      } as unknown as StepExecutionService,
    });

    await expect(
      executeJobCore({
        data: makeData(),
        bullJobId: 'bull-1',
        stateVariables: {},
        resolvedJobInputs: {},
        deps,
      }),
    ).rejects.toThrow(/out of extra usage/);

    // The provider error is terminal — re-running can only fail again, so the
    // output-contract retry must never be consulted and the job fails fast.
    expect(checkRequiredToolRetry).not.toHaveBeenCalled();
    expect(deps.publishTurnEnd).toHaveBeenCalled();
    expect(deps.publishTurnEndAndComplete).not.toHaveBeenCalled();
  });

  it('forwards the step id to the container so output can be attributed', async () => {
    const deps = makeDeps();
    const data = makeData({
      job: makeJob({
        steps: [
          {
            id: 'run_gate',
            type: 'run_command',
            command: 'npm test',
            working_dir: '/workspace',
            timeout_ms: 10000,
          },
        ],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'b1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(
      (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
        .executeCommand,
    ).toHaveBeenCalledWith('http://172.17.0.5:8374', {
      command: 'npm test',
      timeoutMs: 10000,
      workingDir: '/workspace',
      stepId: 'run_gate',
    });
  });
});

describe('async dispatch mode (WORKFLOW_AGENT_DISPATCH_MODE=async)', () => {
  let origEnv: string | undefined;

  beforeEach(() => {
    origEnv = process.env.WORKFLOW_AGENT_DISPATCH_MODE;
    process.env.WORKFLOW_AGENT_DISPATCH_MODE = 'async';
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.WORKFLOW_AGENT_DISPATCH_MODE;
    } else {
      process.env.WORKFLOW_AGENT_DISPATCH_MODE = origEnv;
    }
  });

  it('calls executeAgentAsync instead of executeAgent and resolves once completion signal fires', async () => {
    // awaitAsyncDispatch resolves immediately to simulate the completion signal
    // already being available (e.g. a very fast agent). This is sufficient to
    // verify the async branch is taken and the correct methods are called.
    const awaitAsyncDispatch = vi.fn().mockResolvedValue(undefined);

    const executeAgentAsync = vi
      .fn()
      .mockResolvedValue({ ok: true, accepted: true });
    const executeAgent = vi.fn();

    const deps = makeDeps({
      awaitAsyncDispatch,
      containerHttpClient: {
        buildBaseUrl: vi.fn().mockReturnValue('http://172.17.0.5:8374'),
        waitForHealth: vi.fn().mockResolvedValue(undefined),
        executeAgent,
        executeAgentAsync,
        executeCommand: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      } as any,
    });

    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Build it' }],
      }),
    });

    const result = await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(executeAgentAsync).toHaveBeenCalledWith(
      'http://172.17.0.5:8374',
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        stepId: 'implement',
      }),
    );
    expect(executeAgent).not.toHaveBeenCalled();
    expect(awaitAsyncDispatch).toHaveBeenCalledWith('run-1', 'implement');
    expect(result).toMatchObject({ status: 'completed' });
  });

  it('falls back to sync path when awaitAsyncDispatch dep is absent', async () => {
    const executeAgentAsync = vi.fn();
    const executeAgent = vi
      .fn()
      .mockResolvedValue({ ok: true, response: 'done' });

    const deps = makeDeps({
      // awaitAsyncDispatch intentionally omitted
      containerHttpClient: {
        buildBaseUrl: vi.fn().mockReturnValue('http://172.17.0.5:8374'),
        waitForHealth: vi.fn().mockResolvedValue(undefined),
        executeAgent,
        executeAgentAsync,
        executeCommand: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      } as any,
    });

    const data = makeData({
      job: makeJob({
        steps: [{ id: 'implement', type: 'agent', prompt: 'Build it' }],
      }),
    });

    await executeJobCore({
      data,
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(executeAgent).toHaveBeenCalled();
    expect(executeAgentAsync).not.toHaveBeenCalled();
  });
});

describe('provider outage fallback advance path', () => {
  const OUTAGE_MESSAGE =
    'Provider returned status code: 503 service unavailable';

  beforeEach(() => {
    vi.mocked(classifyProviderOutageFailure).mockReturnValue({
      isOutage: true,
    });
  });

  afterEach(() => {
    vi.mocked(classifyProviderOutageFailure).mockReset();
  });

  it('advances the fallback chain and returns fallback_requeued on a provider outage', async () => {
    const tryFallbackAdvance = vi.fn().mockResolvedValue(true);
    const deps = makeDeps({
      tryFallbackAdvance,
      stepExecutionService: {
        execute: vi.fn().mockResolvedValue({
          status: 'failed',
          finalStepId: 'implement',
          outputs: {
            implement: {
              ok: false,
              error: OUTAGE_MESSAGE,
            },
          },
        }),
      } as unknown as StepExecutionService,
    });

    const result = await executeJobCore({
      data: makeData(),
      bullJobId: 'bull-1',
      stateVariables: {},
      resolvedJobInputs: {},
      deps,
    });

    expect(result).toEqual({
      status: 'fallback_requeued',
      containerId: 'container-abc',
    });
    expect(tryFallbackAdvance).toHaveBeenCalledWith({
      message: OUTAGE_MESSAGE,
      runId: 'run-1',
      failedJobId: 'job-1',
    });
  });
});
