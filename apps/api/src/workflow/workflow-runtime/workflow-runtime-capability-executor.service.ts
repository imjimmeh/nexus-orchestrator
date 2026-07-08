import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { ToolApprovalRuleService } from '../../capability-governance/tool-approval-rule.service';
import { ToolCallApprovalRequestService } from '../../capability-governance/tool-call-approval-request.service';
import { PolicyEngineService } from '../../capability-governance/policy-engine.service';
import {
  findDeniedCapabilityInfo,
  isAgentInvocation,
  readStringArray,
  resolveActorType,
  resolveRuntimeContext,
  toErrorMessage,
} from './workflow-runtime-capability-lifecycle.helpers';
import type {
  GovernanceEvaluationResult,
  RuntimeActionResult,
  RuntimeContext,
  RuntimeContextInput,
  RuntimeExecutionStatus,
} from './workflow-runtime-capability-lifecycle.types';
import { WorkflowRuntimeToolsService } from './workflow-runtime-tools.service';
import { ToolPolicyEvaluatorService } from '../../capability-governance/tool-policy-evaluator.service';
import { isToolPolicyDocument, ToolPolicyEffect } from '@nexus/core';

@Injectable()
export class WorkflowRuntimeCapabilityExecutorService {
  constructor(
    @Inject(forwardRef(() => WorkflowRuntimeToolsService))
    private readonly runtimeTools: WorkflowRuntimeToolsService,
    private readonly eventLedger: EventLedgerService,
    private readonly ruleService: ToolApprovalRuleService,
    private readonly approvalRequestService: ToolCallApprovalRequestService,
    private readonly policyEngine: PolicyEngineService,
    private readonly toolPolicyEvaluator: ToolPolicyEvaluatorService,
  ) {}

  async execute<TResult>(params: {
    capabilityName: string;
    context: RuntimeContextInput;
    payload: Record<string, unknown>;
    execute: () => TResult | Promise<TResult>;
  }): Promise<Record<string, unknown>> {
    const runtimeContext = resolveRuntimeContext(params.context);

    await this.emitLifecycleEvent({
      eventName: 'workflow.runtime.capability.attempt',
      outcome: 'in_progress',
      capabilityName: params.capabilityName,
      context: runtimeContext,
      payload: params.payload,
    });

    const governance = await this.evaluateGovernance({
      capabilityName: params.capabilityName,
      context: runtimeContext,
      payload: params.payload,
    });

    const blockedResult = await this.handleBlockedGovernance({
      capabilityName: params.capabilityName,
      runtimeContext,
      payload: params.payload,
      governance,
    });
    if (blockedResult !== null) {
      return blockedResult;
    }

    return this.executeWithAudit<TResult>({
      capabilityName: params.capabilityName,
      runtimeContext,
      payload: params.payload,
      execute: params.execute,
    });
  }

  async checkPermission(params: {
    capabilityName: string;
    context: RuntimeContextInput;
    payload: Record<string, unknown>;
  }): Promise<GovernanceEvaluationResult> {
    const runtimeContext = resolveRuntimeContext(params.context);

    await this.emitLifecycleEvent({
      eventName: 'workflow.runtime.capability.attempt',
      outcome: 'in_progress',
      capabilityName: params.capabilityName,
      context: runtimeContext,
      payload: params.payload,
    });

    return this.evaluateGovernance({
      capabilityName: params.capabilityName,
      context: runtimeContext,
      payload: params.payload,
    });
  }

  private async handleBlockedGovernance(params: {
    capabilityName: string;
    runtimeContext: RuntimeContext;
    payload: Record<string, unknown>;
    governance: GovernanceEvaluationResult;
  }): Promise<Record<string, unknown> | null> {
    if (params.governance.status === 'denied') {
      await this.emitLifecycleEvent({
        eventName: 'workflow.runtime.capability.denied',
        outcome: 'denied',
        capabilityName: params.capabilityName,
        context: params.runtimeContext,
        payload: {
          ...params.payload,
          reason: params.governance.reason,
          denied_reason_code: params.governance.deniedReasonCode,
        },
      });

      return this.buildActionResult({
        capabilityName: params.capabilityName,
        context: params.runtimeContext,
        ok: false,
        executionStatus: 'denied',
        reason: params.governance.reason,
        deniedReasonCode: params.governance.deniedReasonCode,
      });
    }

    if (params.governance.status === 'approval_required') {
      await this.emitLifecycleEvent({
        eventName: 'workflow.runtime.capability.approval_required',
        outcome: 'denied',
        capabilityName: params.capabilityName,
        context: params.runtimeContext,
        payload: {
          ...params.payload,
          reason: params.governance.reason,
        },
      });

      return this.buildActionResult({
        capabilityName: params.capabilityName,
        context: params.runtimeContext,
        ok: false,
        executionStatus: 'approval_required',
        reason: params.governance.reason,
      });
    }

    return null;
  }

  private async executeWithAudit<TResult>(params: {
    capabilityName: string;
    runtimeContext: RuntimeContext;
    payload: Record<string, unknown>;
    execute: () => TResult | Promise<TResult>;
  }): Promise<Record<string, unknown>> {
    try {
      const result = await params.execute();
      await this.emitLifecycleEvent({
        eventName: 'workflow.runtime.capability.succeeded',
        outcome: 'success',
        capabilityName: params.capabilityName,
        context: params.runtimeContext,
        payload: params.payload,
      });

      return this.buildActionResult({
        capabilityName: params.capabilityName,
        context: params.runtimeContext,
        ok: true,
        executionStatus: 'executed',
        result,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      await this.emitLifecycleEvent({
        eventName: 'workflow.runtime.capability.failed',
        outcome: 'failure',
        capabilityName: params.capabilityName,
        context: params.runtimeContext,
        payload: params.payload,
        errorCode: 'workflow_runtime_capability_failed',
        errorMessage: message,
      });

      return this.buildActionResult({
        capabilityName: params.capabilityName,
        context: params.runtimeContext,
        ok: false,
        executionStatus: 'failed',
        error: message,
      });
    }
  }

  private async evaluateGovernance(params: {
    capabilityName: string;
    context: RuntimeContext;
    payload: Record<string, unknown>;
  }): Promise<GovernanceEvaluationResult> {
    if (
      (!params.context.workflowRunId || !params.context.jobId) &&
      !params.context.chatSessionId
    ) {
      if (isAgentInvocation(params.context.user)) {
        return {
          status: 'denied',
          reason:
            'workflow_run_id and job_id (or chat_session_id) are required for agent runtime capability calls',
          deniedReasonCode: 'missing_agent_execution_context',
        };
      }

      return { status: 'allow' };
    }

    const capabilitySnapshot = await this.runtimeTools.getCapabilities({
      workflow_run_id: params.context.workflowRunId ?? undefined,
      job_id: params.context.jobId ?? undefined,
      chat_session_id: params.context.chatSessionId ?? undefined,
      user: params.context.user,
    });

    const approvalRequiredTools = readStringArray(
      capabilitySnapshot.approval_required_tools,
    );

    const scopeId = this.readOptionalString(
      capabilitySnapshot.scope_id ?? capabilitySnapshot.scopeId,
    );

    const ruleEffect = await this.ruleService.resolveToolEffectExecution(
      {
        scopeId,
        workflowRunId: params.context.workflowRunId ?? undefined,
        chatSessionId: params.context.chatSessionId ?? undefined,
        agentProfile: params.context.user?.agentProfileName,
      },
      params.capabilityName,
      params.payload,
    );
    const agentToolPolicyEffect = this.resolveAgentToolPolicyEffect({
      snapshot: capabilitySnapshot,
      capabilityName: params.capabilityName,
      payload: params.payload,
    });

    return this.evaluateSnapshotDecision({
      capabilityName: params.capabilityName,
      callableTools: readStringArray(capabilitySnapshot.callable_tools),
      approvalRequiredTools,
      deniedTools: this.toDeniedTools(capabilitySnapshot.denied_tools),
      context: params.context,
      payload: params.payload,
      scopeId,
      ruleEffect: this.combineRuleEffects(ruleEffect, agentToolPolicyEffect),
    });
  }

  private resolveAgentToolPolicyEffect(params: {
    snapshot: Record<string, unknown>;
    capabilityName: string;
    payload: Record<string, unknown>;
  }): ToolPolicyEffect | null {
    if (
      !Object.prototype.hasOwnProperty.call(
        params.snapshot,
        'agent_tool_policy',
      )
    ) {
      return null;
    }

    const policy = params.snapshot.agent_tool_policy;
    if (policy === null || policy === undefined) {
      return null;
    }

    if (!isToolPolicyDocument(policy)) {
      return ToolPolicyEffect.DENY;
    }

    const decision = this.toolPolicyEvaluator.evaluate(
      params.capabilityName,
      params.payload,
      policy,
    );

    return decision.effect;
  }

  private combineRuleEffects(
    ruleEffect: 'allow' | 'deny' | 'require_approval' | null,
    agentToolPolicyEffect: ToolPolicyEffect | null,
  ): 'allow' | 'deny' | 'require_approval' | null {
    if (
      ruleEffect === ToolPolicyEffect.DENY ||
      agentToolPolicyEffect === ToolPolicyEffect.DENY ||
      agentToolPolicyEffect === ToolPolicyEffect.GUARDRAIL_DENY
    ) {
      return ToolPolicyEffect.DENY;
    }

    if (
      ruleEffect === ToolPolicyEffect.REQUIRE_APPROVAL ||
      agentToolPolicyEffect === ToolPolicyEffect.REQUIRE_APPROVAL
    ) {
      return ToolPolicyEffect.REQUIRE_APPROVAL;
    }

    return ruleEffect;
  }

  private async evaluateSnapshotDecision(params: {
    capabilityName: string;
    callableTools: string[];
    approvalRequiredTools: string[];
    deniedTools: Array<Record<string, unknown>>;
    context: RuntimeContext;
    payload: Record<string, unknown>;
    scopeId?: string;
    ruleEffect?: 'allow' | 'deny' | 'require_approval' | null;
  }): Promise<GovernanceEvaluationResult> {
    const deniedInfo = findDeniedCapabilityInfo(
      params.deniedTools,
      params.capabilityName,
    );
    const isCallable = params.callableTools.includes(params.capabilityName);
    const isApprovalRequired = params.approvalRequiredTools.includes(
      params.capabilityName,
    );
    const hasDeniedInfo = Boolean(deniedInfo.reason || deniedInfo.reasonCode);
    const profileDecision = resolveProfileDecision(
      hasDeniedInfo,
      isCallable,
      isApprovalRequired,
    );

    const decision = this.policyEngine.decide({
      capabilityName: params.capabilityName,
      isRegistered: isCallable || isApprovalRequired || hasDeniedInfo,
      profileDecision,
      workflowDenied: hasDeniedInfo,
      workflowAllowed: isCallable || isApprovalRequired,
      modeOutcome: isApprovalRequired ? 'allow' : isCallable ? 'allow' : 'deny',
      approvalRequiredByProfile: isApprovalRequired,
      ruleEffect: params.ruleEffect,
    });

    if (decision.status === 'allow') {
      return { status: 'allow' };
    }

    if (decision.status === 'approval_required') {
      return this.evaluateApprovalRequiredDecision(params);
    }

    return {
      status: 'denied',
      reason:
        deniedInfo.reason ??
        decision.deniedReason?.reason ??
        `Capability '${params.capabilityName}' is denied`,
      deniedReasonCode:
        deniedInfo.reasonCode ?? decision.deniedReason?.reasonCode,
    };
  }

  private async evaluateApprovalRequiredDecision(params: {
    capabilityName: string;
    context: RuntimeContext;
    payload: Record<string, unknown>;
    scopeId?: string;
  }): Promise<GovernanceEvaluationResult> {
    const approval =
      await this.approvalRequestService.requestAndWaitForApproval({
        workflowRunId: params.context.workflowRunId ?? undefined,
        jobId: params.context.jobId ?? undefined,
        scopeId: params.scopeId,
        chatSessionId: params.context.chatSessionId ?? undefined,
        toolName: params.capabilityName,
        payload: params.payload,
        requestedBy: params.context.user?.userId ?? 'system',
      });

    if (approval.status === 'approved') {
      return { status: 'allow' };
    }

    if (approval.status === 'rejected') {
      return {
        status: 'denied',
        reason:
          approval.rejectionReason ??
          `Capability '${params.capabilityName}' approval was rejected`,
        deniedReasonCode: 'approval_rejected',
      };
    }

    return {
      status: 'denied',
      reason: `Capability '${params.capabilityName}' approval request expired`,
      deniedReasonCode: 'approval_expired',
    };
  }

  private async emitLifecycleEvent(params: {
    eventName: string;
    outcome: 'in_progress' | 'success' | 'failure' | 'denied';
    capabilityName: string;
    context: RuntimeContext;
    payload?: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    await this.eventLedger.emitBestEffort({
      domain: 'workflow.runtime.capability',
      eventName: params.eventName,
      outcome: params.outcome,
      actorType: resolveActorType(params.context.user),
      actorId: params.context.user?.userId,
      workflowRunId: params.context.workflowRunId ?? undefined,
      jobId: params.context.jobId ?? undefined,
      toolName: params.capabilityName,
      payload: params.payload,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    });
  }

  private buildActionResult(params: {
    capabilityName: string;
    context: RuntimeContext;
    ok: boolean;
    executionStatus: RuntimeExecutionStatus;
    reason?: string;
    deniedReasonCode?: string;
    error?: string;
    result?: unknown;
  }): RuntimeActionResult {
    return {
      ok: params.ok,
      action: params.capabilityName,
      execution_status: params.executionStatus,
      workflow_run_id: params.context.workflowRunId,
      job_id: params.context.jobId,
      reason: params.reason,
      denied_reason_code: params.deniedReasonCode,
      error: params.error,
      result: params.result,
    };
  }

  private toDeniedTools(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === 'object' && !Array.isArray(entry),
    );
  }

  private readOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}

function resolveProfileDecision(
  hasDeniedInfo: boolean,
  isCallable: boolean,
  isApprovalRequired: boolean,
): 'allow' | 'deny' | 'unchecked' {
  if (hasDeniedInfo) {
    return 'deny';
  }

  if (!isCallable && !isApprovalRequired) {
    return 'unchecked';
  }

  return 'allow';
}
