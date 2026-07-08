import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { normalizeOptionalString } from '@nexus/core';
import type { HarnessId } from '@nexus/core';
import {
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_PERSISTENCE_SERVICE,
} from '../kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflowEngineService,
  IWorkflowPersistenceService,
} from '../kernel/interfaces/workflow-kernel.ports';
import {
  CHAT_SESSION_DOMAIN_PORT,
  type ChatSessionDomainPort,
} from '../domain-ports';
import { AgentAwaitRegistryService } from '../workflow-await/agent-await-registry.service';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import { ScopedAiDefaultResolver } from '../../harness/scoped-ai-default-resolver';
import {
  resolveHarnessId,
  FALLBACK_HARNESS_ID,
} from '../../harness/harness-selection';
import { RunnerConfigStoreService } from '../../redis/runner-config-store.service';
import { DelegationCircuitBreakerService } from './delegation-circuit-breaker.service';
import {
  firstNormalizedString,
  inferManagedCloneBasePath,
} from './workflow-runtime-orchestration-actions.helpers';
import type {
  AwaitAgentWorkflowParams,
  AwaitAgentWorkflowResponse,
} from './workflow-runtime-await-actions.service.types';
import {
  AWAIT_EXECUTION_STATUS_SUSPENDED,
  AWAIT_REQUESTED_ACTION,
} from './workflow-runtime-await-actions.service.types';

const RESUME_REQUIRED_ERROR =
  'await_agent_workflow requires a resume-capable engine';
const AWAIT_DISABLED_ERROR =
  'await_agent_workflow is disabled (ORCHESTRATION_AWAIT_ENABLED=false)';
const ORCHESTRATION_AWAIT_ENABLED_ENV = 'ORCHESTRATION_AWAIT_ENABLED';
const FLAG_DISABLED_VALUE = 'false';

/**
 * Run statuses that cannot be awaited because they are already terminal. An
 * agent attaching to a finished run would suspend forever (no future terminal
 * event to resume on). Compared case-insensitively.
 */
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/**
 * Durable agent-await is enabled by default (including dev). It is only
 * disabled when {@link ORCHESTRATION_AWAIT_ENABLED_ENV} is explicitly set to
 * `false`, mirroring the opt-out style of other orchestration feature flags.
 */
export function isOrchestrationAwaitEnabled(): boolean {
  const value =
    process.env[ORCHESTRATION_AWAIT_ENABLED_ENV]?.trim().toLowerCase();
  return value !== FLAG_DISABLED_VALUE;
}

interface AwaitTargetWorkflow {
  workflowId: string;
  inputs: Record<string, unknown>;
}

/**
 * AGENT-CALLABLE durable await: lets a running agent spawn one or more child
 * workflows and suspend its current step until every child reaches a terminal
 * state. Mirrors the fire-and-forget `invoke_agent_workflow` capability but
 * records the parent link and opens a durable await record instead of
 * returning immediately.
 *
 * Domain-neutral: deals only in run, step, scope, and session identifiers.
 */
@Injectable()
export class WorkflowRuntimeAwaitActionsService {
  constructor(
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly awaitRegistry: AgentAwaitRegistryService,
    @Inject(CHAT_SESSION_DOMAIN_PORT)
    private readonly sessionHydration: ChatSessionDomainPort,
    private readonly harnessRegistry: HarnessProviderRegistryService,
    private readonly scopedDefaults: ScopedAiDefaultResolver,
    private readonly runnerConfigStore: RunnerConfigStoreService,
    private readonly circuitBreaker: DelegationCircuitBreakerService,
  ) {}

  /**
   * Starts every requested child workflow on behalf of the calling run/step and
   * registers a durable await so the calling step suspends until all children
   * complete.
   *
   * The calling run's engine must be resume-capable; otherwise no children are
   * started and a {@link BadRequestException} is thrown.
   */
  async startAwaitedInvocationWorkflows(
    params: AwaitAgentWorkflowParams,
  ): Promise<AwaitAgentWorkflowResponse> {
    if (!isOrchestrationAwaitEnabled()) {
      throw new BadRequestException(AWAIT_DISABLED_ERROR);
    }

    const parentRunId = normalizeOptionalString(params.workflow_run_id);
    const parentStepId = normalizeOptionalString(params.step_id);
    if (!parentRunId || !parentStepId) {
      throw new BadRequestException(
        'await_agent_workflow requires the calling run and step identifiers.',
      );
    }

    const targets = this.resolveAwaitTargets(params);
    const attachRunIds = this.resolveAttachRunIds(params);
    if (targets.length === 0 && attachRunIds.length === 0) {
      throw new BadRequestException(
        'await_agent_workflow requires at least one launch target ' +
          '(workflow_id or workflows[]) or awaited_run_ids to attach to. ' +
          'It does not launch a default workflow.',
      );
    }

    await this.assertCircuitClosed(targets);
    await this.assertResumeCapableEngine(parentRunId, parentStepId);

    const parentScopeId = await this.resolveRunScopeNodeId(parentRunId);
    const attachedRunIds = await this.resolveAttachedAwaitedRuns(
      attachRunIds,
      parentScopeId,
    );

    const startedRunIds = await this.startAwaitedChildren(
      parentRunId,
      parentStepId,
      targets,
    );
    const awaitedRunIds = [...startedRunIds, ...attachedRunIds];

    const parentSessionTreeId =
      await this.resolveParentSessionTreeId(parentRunId);

    const created = await this.awaitRegistry.register({
      parentRunId,
      parentStepId,
      parentSessionTreeId,
      awaitedRunIds,
    });

    return {
      ok: true,
      requestedAction: AWAIT_REQUESTED_ACTION,
      executionStatus: AWAIT_EXECUTION_STATUS_SUSPENDED,
      awaitId: created.id,
      awaitedRunIds,
    };
  }

  private resolveAwaitTargets(
    params: AwaitAgentWorkflowParams,
  ): AwaitTargetWorkflow[] {
    const rawWorkflows = Array.isArray(params.workflows)
      ? params.workflows
      : [params];

    return rawWorkflows
      .map((entry) => this.normalizeAwaitTarget(entry))
      .filter((target): target is AwaitTargetWorkflow => target !== null);
  }

  /**
   * Reads explicit run ids the caller wants to attach an await to (runs it
   * already started, e.g. via `delegate_*`). Accepts the plural
   * `awaited_run_ids` array and the singular `awaited_run_id`.
   */
  private resolveAttachRunIds(params: AwaitAgentWorkflowParams): string[] {
    const ids = new Set<string>();
    const single = normalizeOptionalString(params.awaited_run_id);
    if (single) {
      ids.add(single);
    }
    if (Array.isArray(params.awaited_run_ids)) {
      for (const entry of params.awaited_run_ids) {
        const id = normalizeOptionalString(entry);
        if (id) {
          ids.add(id);
        }
      }
    }
    return [...ids];
  }

  /**
   * Validates each run id the caller wants to attach to: it must exist, be
   * non-terminal (otherwise the await would never resume), and share the
   * calling run's scope. Returns the validated ids unchanged. Launches nothing.
   */
  private async resolveAttachedAwaitedRuns(
    attachRunIds: string[],
    parentScopeId: string | undefined,
  ): Promise<string[]> {
    for (const runId of attachRunIds) {
      const run = await this.workflowPersistence.getWorkflowRun(runId);
      if (!run) {
        throw new BadRequestException(
          `await_agent_workflow cannot attach to run "${runId}": run not found.`,
        );
      }

      const status = normalizeOptionalString(
        (run as { status?: unknown }).status,
      )?.toLowerCase();
      if (status && TERMINAL_RUN_STATUSES.has(status)) {
        throw new BadRequestException(
          `await_agent_workflow cannot attach to run "${runId}": it is already ${status}.`,
        );
      }

      const runScopeId = this.readScopeFromRun(run);
      if (parentScopeId && runScopeId && runScopeId !== parentScopeId) {
        throw new BadRequestException(
          `await_agent_workflow cannot attach to run "${runId}": it belongs to a different scope.`,
        );
      }
    }
    return attachRunIds;
  }

  private normalizeAwaitTarget(entry: unknown): AwaitTargetWorkflow | null {
    const record = this.normalizeRecord(entry);
    const workflowId = normalizeOptionalString(record.workflow_id);
    if (!workflowId) {
      // No silent default: a target without an explicit workflow_id is dropped
      // so callers cannot accidentally launch a contextless default workflow.
      return null;
    }
    const explicitInputs = this.normalizeRecord(record.inputs);
    const inputs: Record<string, unknown> = { ...explicitInputs };

    this.setOptionalField(
      inputs,
      'agent_profile',
      normalizeOptionalString(record.agent_profile) ??
        normalizeOptionalString(explicitInputs.agent_profile),
    );
    this.setOptionalField(
      inputs,
      'objective',
      normalizeOptionalString(record.objective) ??
        normalizeOptionalString(record.task_prompt) ??
        normalizeOptionalString(explicitInputs.objective),
    );

    return { workflowId, inputs };
  }

  /**
   * Refuses to launch a delegation that is circuit-broken — i.e. its target
   * workflow keeps failing the same human-required way (e.g. a tool-contract
   * mismatch). Without this, the autonomous loop re-launches the identical
   * doomed delegation every cycle. Thrown before any child starts, so the
   * suspend/await is never registered for a launch we refuse to make.
   */
  private async assertCircuitClosed(
    targets: AwaitTargetWorkflow[],
  ): Promise<void> {
    for (const target of targets) {
      const workflowDefinitionId = await this.resolveWorkflowDefinitionId(
        target.workflowId,
      );
      const evaluation =
        await this.circuitBreaker.evaluate(workflowDefinitionId);
      if (evaluation.open) {
        throw new BadRequestException(
          `Delegation to workflow "${target.workflowId}" is circuit-broken: ${evaluation.occurrences.toString()} repeated ${evaluation.failureClass} failures (threshold ${evaluation.threshold.toString()}) with no resolution. Not re-launching — record a blocked decision and escalate for human repair.`,
        );
      }
    }
  }

  /**
   * Resolves a workflow key/id to the canonical definition id that runs (and
   * therefore failure-classification signals) are recorded against, so the
   * circuit breaker matches the right workflow. Falls back to the supplied key
   * when the workflow cannot be resolved.
   */
  private async resolveWorkflowDefinitionId(
    workflowKey: string,
  ): Promise<string> {
    try {
      const workflow = await this.workflowPersistence.getWorkflow(workflowKey);
      return (
        normalizeOptionalString((workflow as { id?: string } | null)?.id) ??
        workflowKey
      );
    } catch {
      return workflowKey;
    }
  }

  private async assertResumeCapableEngine(
    parentRunId: string,
    parentStepId: string,
  ): Promise<void> {
    const harnessId = await this.resolveCallingRunHarnessId(
      parentRunId,
      parentStepId,
    );
    const { capabilities } = this.harnessRegistry.resolve(harnessId);
    if (!capabilities.supportsResume) {
      throw new BadRequestException(RESUME_REQUIRED_ERROR);
    }
  }

  /**
   * Resolves the harness id for the calling step. Prefers the already-resolved
   * id stored in the runner-config Redis entry (which incorporates any per-step
   * `harness_id` override) and falls back to scope/platform defaults when no
   * runner config has been stored yet (e.g. reconciler-driven re-checks).
   */
  private async resolveCallingRunHarnessId(
    parentRunId: string,
    parentStepId: string,
  ): Promise<HarnessId> {
    const stored = await this.runnerConfigStore.get(parentRunId, parentStepId);
    if (stored?.harnessId) {
      return stored.harnessId;
    }
    const scopeNodeId = await this.resolveRunScopeNodeId(parentRunId);
    const scoped = await this.scopedDefaults.resolve(scopeNodeId);
    return resolveHarnessId({
      projectDefault: scoped.harnessId,
      platformDefault: FALLBACK_HARNESS_ID,
    });
  }

  /**
   * Reads the calling run's trigger scope so harness precedence resolves against
   * the same scoped defaults the run was launched under. Returns undefined when
   * the run or its scope cannot be resolved, letting precedence fall back to the
   * platform default.
   */
  private async resolveRunScopeNodeId(
    parentRunId: string,
  ): Promise<string | undefined> {
    const run = await this.workflowPersistence.getWorkflowRun(parentRunId);
    return this.readScopeFromRun(run);
  }

  /** Extracts the launch-trigger scope id from a (possibly null) run record. */
  private readScopeFromRun(run: unknown): string | undefined {
    const state = this.normalizeRecord(
      (run as { state_variables?: unknown } | null)?.state_variables,
    );
    const trigger = this.normalizeRecord(state.trigger);
    return (
      normalizeOptionalString(trigger.scopeId) ??
      normalizeOptionalString(trigger.scope_id) ??
      undefined
    );
  }

  private async startAwaitedChildren(
    parentRunId: string,
    parentStepId: string,
    targets: AwaitTargetWorkflow[],
  ): Promise<string[]> {
    const parentRun =
      await this.workflowPersistence.getWorkflowRun(parentRunId);
    const parentScopeId = this.readScopeFromRun(parentRun);
    const parentPaths = this.readWorkspacePathsFromRun(parentRun);
    const awaitedRunIds: string[] = [];
    for (const target of targets) {
      const childRunId = await this.workflowEngine.startWorkflow(
        target.workflowId,
        {
          parentWorkflowRunId: parentRunId,
          parentStepId,
          ...this.withInheritedWorkspacePaths(
            this.withInheritedScope(target.inputs, parentScopeId),
            parentPaths,
            parentScopeId,
          ),
        },
      );
      if (childRunId === null) {
        throw new BadRequestException(
          `await_agent_workflow could not start child workflow "${target.workflowId}" because concurrency policy skipped the invocation.`,
        );
      }
      awaitedRunIds.push(childRunId);
    }
    return awaitedRunIds;
  }

  private async resolveParentSessionTreeId(
    parentRunId: string,
  ): Promise<string | null> {
    const sessionTree =
      await this.sessionHydration.findSessionTreeByWorkflowRunId(parentRunId);
    return sessionTree?.id ?? null;
  }

  /**
   * Child workflows resolve their scope from `scopeId`/`scope_id` in their
   * launch trigger data (see WorkflowLaunchContractService) — they do not
   * inherit it from the parent-run link alone. So awaited children must carry
   * the calling run's scope explicitly, mirroring the fire-and-forget
   * `invoke_agent_workflow` path. An explicit scope in the child inputs wins.
   */
  private withInheritedScope(
    inputs: Record<string, unknown>,
    parentScopeId: string | undefined,
  ): Record<string, unknown> {
    const alreadyScoped =
      normalizeOptionalString(inputs.scopeId) ??
      normalizeOptionalString(inputs.scope_id);
    if (alreadyScoped || !parentScopeId) {
      return inputs;
    }
    return { ...inputs, scopeId: parentScopeId, scope_id: parentScopeId };
  }

  /** Extracts the host-visible workspace paths from a (possibly null) run. */
  private readWorkspacePathsFromRun(run: unknown): {
    basePath: string | null;
    repositoryUrl: string | null;
  } {
    const state = this.normalizeRecord(
      (run as { state_variables?: unknown } | null)?.state_variables,
    );
    const trigger = this.normalizeRecord(state.trigger);
    return {
      basePath: firstNormalizedString([trigger.basePath, trigger.base_path]),
      repositoryUrl: firstNormalizedString([
        trigger.repositoryUrl,
        trigger.repository_url,
      ]),
    };
  }

  /**
   * Awaited children resolve their workspace from `basePath`/`repositoryUrl` in
   * their launch trigger — the durable-await path otherwise drops them, so an
   * imported-repo child stalls on an empty `workspace_root` when it publishes
   * downstream. Mirror the fire-and-forget `invoke_agent_workflow` path:
   * inherit from the parent trigger, falling back to the managed-clone layout.
   * An explicit value in the child inputs wins.
   */
  private withInheritedWorkspacePaths(
    inputs: Record<string, unknown>,
    parentPaths: { basePath: string | null; repositoryUrl: string | null },
    parentScopeId: string | undefined,
  ): Record<string, unknown> {
    const explicitBasePath = firstNormalizedString([
      inputs.basePath,
      inputs.base_path,
    ]);
    const explicitRepositoryUrl = firstNormalizedString([
      inputs.repositoryUrl,
      inputs.repository_url,
    ]);

    const repositoryUrl = explicitRepositoryUrl ?? parentPaths.repositoryUrl;
    const basePath =
      explicitBasePath ??
      parentPaths.basePath ??
      inferManagedCloneBasePath(parentScopeId ?? null, repositoryUrl);

    const result = { ...inputs };
    if (basePath) {
      result.basePath = basePath;
    }
    if (repositoryUrl) {
      result.repositoryUrl = repositoryUrl;
    }
    return result;
  }

  private setOptionalField(
    target: Record<string, unknown>,
    key: string,
    value: string | null,
  ): void {
    if (value) {
      target[key] = value;
    } else {
      Reflect.deleteProperty(target, key);
    }
  }

  private normalizeRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
