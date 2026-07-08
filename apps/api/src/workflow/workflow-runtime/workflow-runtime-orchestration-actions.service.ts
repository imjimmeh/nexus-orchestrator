import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeOptionalString } from '@nexus/core';
import {
  firstNormalizedString,
  firstUuid,
  inferManagedCloneBasePath,
  isKnownWorkflowNotFoundError,
  normalizeRecord,
  toMutatingActionResponse,
} from './workflow-runtime-orchestration-actions.helpers';
import type { InvokeAgentWorkflowParams } from './workflow-runtime-orchestration-actions.service.types';
import type {
  InvocationInputs,
  ParentContext,
} from './workflow-runtime-orchestration-actions-internal.types';
import {
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_PERSISTENCE_SERVICE,
} from '../kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflowEngineService,
  IWorkflowPersistenceService,
} from '../kernel/interfaces/workflow-kernel.ports';
import { DelegationCircuitBreakerService } from './delegation-circuit-breaker.service';

const DEFAULT_AGENT_INVOCATION_WORKFLOW_ID =
  'orchestration_invoke_agent_default';

@Injectable()
export class WorkflowRuntimeOrchestrationActionsService {
  constructor(
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly circuitBreaker: DelegationCircuitBreakerService,
  ) {}

  async invokeAgentWorkflow(
    params: InvokeAgentWorkflowParams,
  ): Promise<Record<string, unknown>> {
    const inputs = this.resolveInvocationInputs(params);

    const circuitSkip = await this.evaluateDelegationCircuit(inputs);
    if (circuitSkip) {
      return circuitSkip;
    }

    const scopeId = await this.resolveScopeId(
      params,
      inputs.explicitTriggerData,
    );
    const parentContext = await this.resolveParentContext(params);
    const dedupeKey = this.resolveInvocationDedupeKey(params, inputs, scopeId);
    const triggerData = this.buildInvocationTriggerData(
      params,
      inputs,
      parentContext,
      scopeId,
      dedupeKey,
    );

    return this.startInvocationWorkflow(inputs, triggerData);
  }

  private resolveInvocationInputs(
    params: InvokeAgentWorkflowParams,
  ): InvocationInputs {
    const workflowId =
      normalizeOptionalString(params.workflow_id) ??
      DEFAULT_AGENT_INVOCATION_WORKFLOW_ID;
    const agentProfile = normalizeOptionalString(params.agent_profile);
    const reason = normalizeOptionalString(params.reason);
    const reasoning = normalizeOptionalString(params.reasoning) ?? reason;
    const explicitTriggerData = normalizeRecord(params.trigger_data);
    const taskPrompt =
      normalizeOptionalString(params.task_prompt) ??
      normalizeOptionalString(explicitTriggerData.task_prompt);
    const message =
      normalizeOptionalString(explicitTriggerData.message) ??
      normalizeOptionalString(params.message);
    const objective =
      normalizeOptionalString(explicitTriggerData.objective) ??
      normalizeOptionalString(params.objective);

    return {
      agentProfile,
      explicitTriggerData,
      message,
      objective,
      reason,
      reasoning,
      taskPrompt,
      workflowId,
    };
  }

  private buildInvocationTriggerData(
    params: InvokeAgentWorkflowParams,
    inputs: InvocationInputs,
    parentContext: ParentContext,
    scopeId: string | null,
    dedupeKey: string,
  ): Record<string, unknown> {
    const effectivePaths = this.resolveEffectiveInvocationPaths(
      inputs,
      parentContext,
      scopeId,
    );

    const triggerData: Record<string, unknown> = {
      ...this.collectOpaqueContext(params),
      ...inputs.explicitTriggerData,
      dedupeKey,
    };
    this.applyInvocationFields(triggerData, inputs, effectivePaths);
    this.applyInvocationScope(triggerData, params, inputs, scopeId);

    return triggerData;
  }

  private resolveEffectiveInvocationPaths(
    inputs: InvocationInputs,
    parentContext: ParentContext,
    scopeId: string | null,
  ): ParentContext {
    const repositoryUrl =
      parentContext.repositoryUrl ??
      normalizeOptionalString(inputs.explicitTriggerData.repositoryUrl);
    return {
      basePath:
        parentContext.basePath ??
        inferManagedCloneBasePath(scopeId, repositoryUrl),
      repositoryUrl,
    };
  }

  private applyInvocationFields(
    triggerData: Record<string, unknown>,
    inputs: InvocationInputs,
    effectivePaths: ParentContext,
  ): void {
    this.setOptionalField(triggerData, 'objective', inputs.objective);
    this.setOptionalField(triggerData, 'agent_profile', inputs.agentProfile);
    this.setOptionalField(triggerData, 'reason', inputs.reason);
    this.setOptionalField(triggerData, 'reasoning', inputs.reasoning);
    this.setOptionalField(triggerData, 'message', inputs.message);
    this.setOptionalField(triggerData, 'task_prompt', inputs.taskPrompt);
    this.setOptionalField(triggerData, 'basePath', effectivePaths.basePath);
    this.setOptionalField(
      triggerData,
      'repositoryUrl',
      effectivePaths.repositoryUrl,
    );
    if (inputs.taskPrompt && !inputs.objective) {
      triggerData.objective = inputs.taskPrompt;
    }
    delete triggerData.base_path;
    delete triggerData.repository_url;
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

  private applyInvocationScope(
    triggerData: Record<string, unknown>,
    params: InvokeAgentWorkflowParams,
    inputs: InvocationInputs,
    scopeId: string | null,
  ): void {
    if (scopeId) {
      triggerData.scope_id = scopeId;
      triggerData.scopeId = scopeId;
      return;
    }

    const nonUuidScopeId = this.resolveInvocationScope(
      params,
      inputs.explicitTriggerData,
      null,
    );
    if (nonUuidScopeId !== 'global') {
      triggerData.scope_id = nonUuidScopeId;
      triggerData.scopeId = nonUuidScopeId;
      return;
    }

    delete triggerData.scope_id;
    delete triggerData.scopeId;
  }

  /**
   * Refuses a fire-and-forget delegation whose target workflow keeps failing
   * the same human-required way (circuit open) — mirroring the await path — so
   * the autonomous loop does not re-launch the identical doomed run every
   * cycle. Returns a skip response when open, or null to proceed.
   */
  private async evaluateDelegationCircuit(
    inputs: InvocationInputs,
  ): Promise<Record<string, unknown> | null> {
    const workflowDefinitionId = await this.resolveWorkflowDefinitionId(
      inputs.workflowId,
    );
    const evaluation = await this.circuitBreaker.evaluate(workflowDefinitionId);
    if (!evaluation.open) {
      return null;
    }

    const errorMessage = `Delegation to workflow "${inputs.workflowId}" is circuit-broken: ${evaluation.occurrences.toString()} repeated ${evaluation.failureClass} failures (threshold ${evaluation.threshold.toString()}) with no resolution. Not re-launching — record a blocked decision and escalate for human repair.`;
    return toMutatingActionResponse({
      ok: false,
      requestedAction: 'invoke_agent_workflow',
      modeEvaluation: 'allow',
      executionStatus: 'skipped_circuit_open',
      correlationId: randomUUID(),
      runId: null,
      alreadyActive: false,
      agentProfileActual: inputs.agentProfile,
      error: errorMessage,
      errorCode: 'delegation_circuit_open',
      errorMessage,
    });
  }

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

  private async startInvocationWorkflow(
    inputs: InvocationInputs,
    triggerData: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let runId: string | null;
    try {
      runId = await this.workflowEngine.startWorkflow(
        inputs.workflowId,
        triggerData,
      );
    } catch (error) {
      if (
        !isKnownWorkflowNotFoundError(error, inputs.workflowId, ['workflow'])
      ) {
        throw error;
      }

      const errorMessage = `Workflow "${inputs.workflowId}" could not be found. Suggested fix: verify workflow_id or omit workflow_id to use ${DEFAULT_AGENT_INVOCATION_WORKFLOW_ID}.`;
      return toMutatingActionResponse({
        ok: false,
        requestedAction: 'invoke_agent_workflow',
        modeEvaluation: 'allow',
        executionStatus: 'invalid_workflow',
        correlationId: randomUUID(),
        runId: null,
        alreadyActive: false,
        agentProfileActual: inputs.agentProfile,
        requestedWorkflowId: inputs.workflowId,
        error: errorMessage,
        errorCode: 'workflow_not_found',
        errorMessage,
      });
    }

    if (runId === null) {
      const errorMessage =
        'Workflow launch skipped by concurrency policy because an equivalent run is already active for the requested concurrency scope. Suggested fix: do not retry immediately; wait for the active run to finish or inspect workflow concurrency settings.';
      return toMutatingActionResponse({
        ok: false,
        requestedAction: 'invoke_agent_workflow',
        modeEvaluation: 'allow',
        executionStatus: 'skipped_due_concurrency',
        correlationId: randomUUID(),
        runId: null,
        alreadyActive: true,
        agentProfileActual: inputs.agentProfile,
        error: errorMessage,
        errorCode: 'workflow_concurrency_skip',
        errorMessage,
      });
    }

    return toMutatingActionResponse({
      ok: true,
      requestedAction: 'invoke_agent_workflow',
      modeEvaluation: 'allow',
      executionStatus: 'executed',
      correlationId: randomUUID(),
      runId,
      alreadyActive: false,
      agentProfileActual: inputs.agentProfile,
    });
  }

  private async resolveScopeId(
    params: Record<string, unknown>,
    triggerData: Record<string, unknown>,
  ): Promise<string | null> {
    const context = normalizeRecord(params.context);
    const directScopeId = firstUuid([
      params.scope_id,
      params.scopeId,
      triggerData.scope_id,
      triggerData.scopeId,
      context.scope_id,
      context.scopeId,
    ]);
    if (directScopeId) {
      return directScopeId;
    }

    const parentWorkflowRunId = normalizeOptionalString(params.workflow_run_id);
    if (!parentWorkflowRunId) {
      return null;
    }

    try {
      const parentRun =
        await this.workflowPersistence.getWorkflowRun(parentWorkflowRunId);
      const parentState = normalizeRecord(parentRun?.state_variables);
      const parentTrigger = normalizeRecord(parentState.trigger);
      return firstUuid([parentTrigger.scope_id, parentTrigger.scopeId]);
    } catch (error) {
      if (
        !isKnownWorkflowNotFoundError(error, parentWorkflowRunId, [
          'parent run',
          'workflow run',
          'run',
        ])
      ) {
        throw error;
      }

      return null;
    }
  }

  private async resolveParentContext(
    params: Record<string, unknown>,
  ): Promise<{ basePath: string | null; repositoryUrl: string | null }> {
    const explicitTriggerData = normalizeRecord(params.trigger_data);
    const parentWorkflowRunId = normalizeOptionalString(params.workflow_run_id);

    // Check explicit trigger_data first
    const explicitBasePath = firstNormalizedString([
      explicitTriggerData.basePath,
      explicitTriggerData.base_path,
    ]);
    const explicitRepositoryUrl = firstNormalizedString([
      explicitTriggerData.repositoryUrl,
      explicitTriggerData.repository_url,
    ]);

    if (!parentWorkflowRunId) {
      return {
        basePath: explicitBasePath,
        repositoryUrl: explicitRepositoryUrl,
      };
    }

    try {
      const parentRun =
        await this.workflowPersistence.getWorkflowRun(parentWorkflowRunId);
      const parentState = normalizeRecord(parentRun.state_variables);
      const parentTrigger = normalizeRecord(parentState.trigger);

      return {
        basePath:
          explicitBasePath ??
          firstNormalizedString([
            parentTrigger.basePath,
            parentTrigger.base_path,
          ]),
        repositoryUrl:
          explicitRepositoryUrl ??
          firstNormalizedString([
            parentTrigger.repositoryUrl,
            parentTrigger.repository_url,
          ]),
      };
    } catch (error) {
      if (
        !isKnownWorkflowNotFoundError(error, parentWorkflowRunId, [
          'parent run',
          'workflow run',
          'run',
        ])
      ) {
        throw error;
      }

      return {
        basePath: explicitBasePath,
        repositoryUrl: explicitRepositoryUrl,
      };
    }
  }

  private collectOpaqueContext(
    params: InvokeAgentWorkflowParams,
  ): Record<string, unknown> {
    const excluded = new Set([
      'workflow_id',
      'agent_profile',
      'task_prompt',
      'trigger_data',
      'workflow_run_id',
      'reasoning',
      'reason',
    ]);
    return Object.fromEntries(
      Object.entries(params).filter(([key]) => !excluded.has(key)),
    );
  }

  private resolveInvocationDedupeKey(
    params: Record<string, unknown>,
    inputs: InvocationInputs,
    scopeId: string | null,
  ): string {
    const explicitDedupeKey = firstNormalizedString([
      params.dedupeKey,
      params.dedupe_key,
      inputs.explicitTriggerData.dedupeKey,
      inputs.explicitTriggerData.dedupe_key,
    ]);
    if (explicitDedupeKey) {
      return explicitDedupeKey;
    }

    const parentRunId = normalizeOptionalString(params.workflow_run_id);
    const scope =
      parentRunId ??
      this.resolveInvocationScope(params, inputs.explicitTriggerData, scopeId);
    const agentProfile = inputs.agentProfile ?? 'default';
    const fingerprintPayload =
      inputs.reason ??
      inputs.taskPrompt ??
      inputs.objective ??
      inputs.message ??
      inputs.workflowId;
    const fingerprint = createHash('sha256')
      .update(fingerprintPayload)
      .digest('hex')
      .slice(0, 16);

    return `invoke-agent:${scope}:${inputs.workflowId}:${agentProfile}:${fingerprint}`;
  }

  private resolveInvocationScope(
    params: Record<string, unknown>,
    triggerData: Record<string, unknown>,
    fallbackScopeId: string | null,
  ): string {
    const context = normalizeRecord(params.context);
    return (
      firstNormalizedString([
        params.scope_id,
        params.scopeId,
        triggerData.scope_id,
        triggerData.scopeId,
        context.scope_id,
        context.scopeId,
        fallbackScopeId,
      ]) ?? 'global'
    );
  }
}
