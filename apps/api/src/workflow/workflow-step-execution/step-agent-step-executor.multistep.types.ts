import type {
  IJobStep,
  HarnessRuntimeConfig,
  HarnessSessionRef,
} from '@nexus/core';
import type { ContainerHttpClientService } from '../../docker/container-http-client.service';
import type { JobQueueData } from './step-execution.types';
import type { StepExecutionService } from './step-execution.service';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';

export interface InSessionTransientRetryConfig {
  enabled: boolean;
  maxAttempts: number;
  maxDurationMs: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterRatio: number;
  retry429Unbounded: boolean;
  retry529Unbounded: boolean;
}

export interface JobExecutionDependencies {
  provisionContainer: (
    data: JobQueueData,
    stateVariables: Record<string, unknown>,
  ) => Promise<string>;
  injectSession?: (
    containerId: string,
    resumeSessionTreeId?: string,
  ) => Promise<void>;
  startContainerAndStreamLogs: (
    containerId: string,
    workflowRunId: string,
    jobId: string,
  ) => Promise<() => void>;
  /**
   * Reports the provisioned container to the execution lifecycle (projected
   * as state=running + container_id) so supervision can probe liveness.
   */
  notifyContainerProvisioned?: (containerId: string) => Promise<void>;
  getContainerIp: (containerId: string) => Promise<string>;
  buildStepRunnerConfig: (
    data: JobQueueData,
    step: IJobStep,
    resolvedJobInputs: Record<string, unknown>,
    stateVariables: Record<string, unknown>,
  ) => Promise<HarnessRuntimeConfig>;
  stepExecutionService: StepExecutionService;
  containerHttpClient: ContainerHttpClientService;
  workflowEngine: IWorkflowEngineService;
  publishTurnEndAndComplete: (
    workflowRunId: string,
    jobId: string,
    output: Record<string, unknown>,
  ) => Promise<void>;
  publishTurnEnd: (
    workflowRunId: string,
    jobId: string,
    output: Record<string, unknown>,
  ) => Promise<void>;
  publishProcessEvent?: (
    workflowRunId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  checkRequiredToolRetry: (
    containerId: string,
  ) => Promise<'retried' | 'proceed'>;
  /**
   * Persists the resolved provider/model/harness (and, when the runner config
   * build resolved one, the acting agent profile) onto the executions record
   * so the realised runtime config is observable. Invoked after the runner
   * config is built for an agent step. No-op when the executor was not given
   * an executionId (e.g. ad-hoc invocations without a lifecycle record). The
   * `agent_profile_id`/`agent_profile_name` fields are the source
   * `RetrospectiveAnalysisService.resolveActingAgentProfiles` falls back to
   * for single-agent-per-step runs, which never create a `chat_sessions` row.
   */
  persistResolvedConfig?: (patch: {
    provider: string;
    model: string;
    harness_id: string;
    agent_profile_id?: string | null;
    agent_profile_name?: string | null;
  }) => Promise<void>;
  /**
   * Returns the agent profile resolved while building the runner config for
   * the current agent step (set by `buildStepRunnerConfig`'s caller just
   * before it returns), or `null` when no config has been built yet / the
   * executor does not track this. Read by `persistResolvedConfigBestEffort`
   * to fold the profile identity into the same `persistResolvedConfig` patch.
   */
  getResolvedAgentProfile?: () => {
    id: string | null;
    name: string | null;
  } | null;
  /**
   * Records a liveness heartbeat for the running step's execution (and its
   * workflow run). Invoked on a fixed cadence while a `run_command` step's
   * synchronous container request is in flight, so a long command keeps its
   * execution record fresh and is not reaped by the stale-run watchdog. No-op
   * when the executor was not given a heartbeat sink.
   */
  recordHeartbeat?: () => void;
  saveSession?: (containerId: string) => Promise<string | null>;
  persistProducedSessionRef?: (
    workflowRunId: string,
    ref: HarnessSessionRef,
  ) => Promise<void>;
  killStaleContainers?: (workflowRunId: string, jobId: string) => Promise<void>;
  getInSessionTransientRetryConfig?: () => Promise<InSessionTransientRetryConfig>;
  shouldContinueInSessionRetry?: (workflowRunId: string) => Promise<boolean>;
  sleep?: (delayMs: number) => Promise<void>;
  /** Awaits async-dispatch completion signal. Present only when `ASYNC_DISPATCH_MODE_ENV` equals `ASYNC_DISPATCH_MODE_VALUE`. */
  awaitAsyncDispatch?: (workflowRunId: string, stepId: string) => Promise<void>;
  /**
   * Called before finalizing a terminal provider failure. Returns `true` if the
   * job was requeued via the fallback chain (caller must NOT throw or finalize).
   * Returns `false` when no fallback is viable — caller proceeds with the
   * existing terminal-failure path.
   */
  tryFallbackAdvance?: (params: {
    message: string;
    runId: string;
    failedJobId: string;
  }) => Promise<boolean>;
  cleanup: (
    containerId: string,
    stopLogStreaming: (() => void) | null,
  ) => Promise<void>;
  fetchContainerLogSnapshot: (containerId: string) => Promise<string>;
  isContainerRunning?: (containerId: string) => Promise<boolean>;
  warn: (message: string) => void;
  log: (message: string) => void;
}
