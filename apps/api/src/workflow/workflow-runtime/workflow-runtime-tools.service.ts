import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { IJob } from '@nexus/core';
import { isTerminalWorkflowRunStatus } from '@nexus/core';
import { CapabilityPreflightService } from '../../tool/capability-preflight.service';
import { InternalToolRegistryService } from '../../tool/internal-tool-registry.service';
import {
  CHAT_SESSION_REPOSITORY_PORT,
  type IChatSessionRepositoryPort,
} from '../domain-ports';
import { StandingOrdersService } from '../../automation/standing-orders.service';
import type { RuntimeStandingOrderView } from '../../automation/standing-orders.types';
import { WorkflowRepositoryAggregator } from '../workflow-repository-aggregator.service';
import {
  resolveRequiredNextAction,
  resolveStateVariables,
  parseAgentExecutionContext,
} from './workflow-runtime-tools.context';
import type { AgentUserContext } from './workflow-runtime-tools.types';
import { StepSupportService } from '../workflow-step-execution/step-support.service';
import { normalizeToolPolicy } from '../workflow-step-execution/step-support.helpers';
import { WorkflowRuntimeCapabilityExecutorService } from './workflow-runtime-capability-executor.service';
import { ExecutionContextResolverService } from '../execution-context-resolver.service';
import { ToolContractRepairAdapter } from '../../tool-runtime/tool-contract-repair.adapter';
import { WORKFLOW_PARSER_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowParserService } from '../kernel/interfaces/workflow-kernel.ports';
import { WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import { isRecord } from '@nexus/core';
import {
  buildInternalToolContext,
  buildSubagentCapabilitiesResponse,
  normalizeScopeId,
  resolveAuthoritativeJobId,
  resolveAuthoritativeWorkflowRunId,
  resolveChatSessionIdFromUser,
  resolveJobByIdOrStepId,
  resolveScopeIdFromStateVariables,
  resolveSubagentCapabilityContext,
  toAgentProfileRuntimeSummary,
} from './workflow-runtime-tools.service.helpers';

@Injectable()
export class WorkflowRuntimeToolsService {
  constructor(
    private readonly repos: WorkflowRepositoryAggregator,
    @Inject(WORKFLOW_PARSER_SERVICE)
    private readonly workflowParser: IWorkflowParserService,
    private readonly capabilityPreflight: CapabilityPreflightService,
    private readonly stepSupport: StepSupportService,
    private readonly internalToolRegistry: InternalToolRegistryService,
    @Inject(WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE)
    private readonly runtimeCapabilityExecutor: WorkflowRuntimeCapabilityExecutorService,
    private readonly executionContextResolver: ExecutionContextResolverService,
    private readonly toolContractRepair: ToolContractRepairAdapter,
    @Inject(CHAT_SESSION_REPOSITORY_PORT)
    private readonly chatSessionRepo: IChatSessionRepositoryPort,
    private readonly standingOrders: StandingOrdersService,
  ) {}

  private readonly logger = new Logger(WorkflowRuntimeToolsService.name);

  async getCapabilities(params: {
    workflow_run_id?: string;
    job_id?: string;
    chat_session_id?: string;
    user?: AgentUserContext;
  }): Promise<Record<string, unknown>> {
    const subagentCapabilities =
      await this.resolveSubagentCapabilitiesIfApplicable(params);
    if (subagentCapabilities) return subagentCapabilities;
    const chatCapabilities =
      await this.resolveChatCapabilitiesIfApplicable(params);
    if (chatCapabilities) return chatCapabilities;
    return this.getWorkflowCapabilities(params);
  }

  private async resolveSubagentCapabilitiesIfApplicable(params: {
    workflow_run_id?: string;
    job_id?: string;
    user?: AgentUserContext;
  }): Promise<Record<string, unknown> | null> {
    const context = resolveSubagentCapabilityContext(params);
    if (!context) {
      return null;
    }
    const run = await this.requireRun(context.workflowRunId);
    const stateVariables = resolveStateVariables(run.state_variables);
    const scopeId = resolveScopeIdFromStateVariables(stateVariables);
    const candidateTools = context.allowedTools.map((name) => ({ name }));
    const subagentJob = {
      id: context.subagentExecutionId,
      type: 'execution',
      tier: 'heavy',
      tools: context.allowedTools,
    } as IJob;
    let allowedByProfile = await this.stepSupport.resolveAllowedToolNames({
      tools: candidateTools,
      job: subagentJob,
      workflowPermissions: undefined,
      agentProfile: context.agentProfileName,
      policyStrategy: 'profile_only',
    });
    const workflow = await this.repos.workflows.findByIdentifier(
      run.workflow_id,
      { includeInactive: true },
    );
    if (!workflow)
      throw new NotFoundException(
        `Workflow ${run.workflow_id} not found for run ${run.id}`,
      );
    const definition = this.workflowParser.parseWorkflow(
      workflow.yaml_definition,
    );
    if (definition.permissions) {
      const { deny } = normalizeToolPolicy(definition.permissions);
      if (deny.has('*')) allowedByProfile = new Set<string>();
      else for (const toolName of deny) allowedByProfile.delete(toolName);
    }
    const approvalRequired =
      await this.stepSupport.resolveApprovalRequiredToolNames({
        tools: candidateTools,
        agentProfile: context.agentProfileName,
      });
    const agentToolPolicy = await this.stepSupport.resolveAgentToolPolicy(
      context.agentProfileName,
    );
    const callableTools = context.allowedTools.filter((name) =>
      allowedByProfile.has(name),
    );
    return buildSubagentCapabilitiesResponse({
      context,
      scopeId,
      callableTools,
      deniedTools: context.allowedTools.filter(
        (name) => !allowedByProfile.has(name),
      ),
      approvalRequiredTools: callableTools.filter((name) =>
        approvalRequired.has(name),
      ),
      agentToolPolicy,
      standingOrders: await this.resolveStandingOrders(
        scopeId,
        context.agentProfileName,
      ),
    });
  }

  private async getWorkflowCapabilities(params: {
    workflow_run_id?: string;
    job_id?: string;
    user?: AgentUserContext;
  }): Promise<Record<string, unknown>> {
    const executionContext =
      await this.executionContextResolver.resolveAgentExecutionContext({
        workflowRunId: params.workflow_run_id,
        jobId: params.job_id,
        user: params.user,
      });

    const run = await this.requireRun(executionContext.workflowRunId);
    const workflow = await this.repos.workflows.findByIdentifier(
      run.workflow_id,
      { includeInactive: true },
    );
    if (!workflow)
      throw new NotFoundException(
        `Workflow ${run.workflow_id} not found for run ${run.id}`,
      );
    const definition = this.workflowParser.parseWorkflow(
      workflow.yaml_definition,
    );
    const targetJobId = executionContext.jobId || run.current_step_id || '';
    const job = resolveJobByIdOrStepId(definition.jobs ?? [], targetJobId);
    if (!job)
      throw new NotFoundException(
        `Workflow job ${targetJobId} not found in workflow ${workflow.id}`,
      );
    const stateVariables = resolveStateVariables(run.state_variables);
    const resolvedJobInputs = this.stepSupport.resolveJobInputs(
      job.inputs,
      stateVariables,
    );

    const snapshot = await this.capabilityPreflight.resolveCapabilitySnapshot({
      workflowRunId: run.id,
      jobId: job.id,
      job,
      stateVariables,
      resolvedJobInputs,
      workflowPermissions: definition.permissions || undefined,
      policyStrategy: definition.permissions?.policy_strategy,
    });
    return {
      workflow_run_id: snapshot.workflowRunId,
      job_id: snapshot.jobId,
      scope_id: snapshot.scopeId,
      orchestration_mode: snapshot.mode,
      callable_tools: snapshot.callableToolNames,
      denied_tools: snapshot.denied,
      approval_required_tools: snapshot.approvalRequiredToolNames,
      agent_tool_policy: snapshot.agentToolPolicy,
      required_next_action: resolveRequiredNextAction(snapshot, job),
      standing_orders: await this.resolveStandingOrders(snapshot.scopeId),
    };
  }

  private async resolveChatCapabilitiesIfApplicable(params: {
    workflow_run_id?: string;
    job_id?: string;
    chat_session_id?: string;
    user?: AgentUserContext;
  }): Promise<Record<string, unknown> | null> {
    const chatSessionId =
      params.chat_session_id ??
      resolveChatSessionIdFromUser(
        params.workflow_run_id,
        params.job_id,
        params.user?.userId,
      );
    if (!chatSessionId) {
      return null;
    }
    const chatSession = await this.chatSessionRepo.findById(chatSessionId);
    if (!chatSession) {
      const agentProfileName = params.user?.agentProfileName?.trim();
      if (!agentProfileName) {
        return null;
      }
      return this.getChatCapabilities({
        chat_session_id: chatSessionId,
        agent_profile_name: agentProfileName,
        scope_id: undefined,
      });
    }
    if (
      chatSession.workflow_run_id &&
      chatSession.workflow_run_id !== params.workflow_run_id
    )
      return this.getWorkflowCapabilities({
        workflow_run_id: chatSession.workflow_run_id,
        job_id: undefined,
        user: params.user,
      });
    const agentProfileName = params.user?.agentProfileName?.trim();
    if (!agentProfileName) {
      throw new BadRequestException(
        'agent_profile_name is required for chat capability resolution',
      );
    }
    return this.getChatCapabilities({
      chat_session_id: chatSessionId,
      agent_profile_name: agentProfileName,
      scope_id: undefined,
    });
  }

  async getChatCapabilities(params: {
    chat_session_id: string;
    agent_profile_name: string;
    scope_id?: string | null;
  }): Promise<Record<string, unknown>> {
    const normalizedScopeId = normalizeScopeId(params.scope_id);
    const snapshot =
      await this.capabilityPreflight.resolveChatCapabilitySnapshot({
        chatSessionId: params.chat_session_id,
        agentProfileName: params.agent_profile_name,
        scopeId: normalizedScopeId,
      });
    return {
      chat_session_id: params.chat_session_id,
      agent_profile_name: params.agent_profile_name,
      scope_id: snapshot.scopeId,
      orchestration_mode: snapshot.mode,
      callable_tools: snapshot.callableToolNames,
      denied_tools: snapshot.denied,
      approval_required_tools: snapshot.approvalRequiredToolNames,
      agent_tool_policy: snapshot.agentToolPolicy,
      required_next_action: 'none',
      standing_orders: await this.resolveStandingOrders(
        snapshot.scopeId,
        params.agent_profile_name,
      ),
    };
  }

  async getAgentProfiles(params?: {
    limit?: number;
    offset?: number;
    include_inactive?: boolean;
  }): Promise<Record<string, unknown>> {
    const pagination = {
      limit:
        typeof params?.limit === 'number' &&
        Number.isInteger(params.limit) &&
        params.limit > 0
          ? params.limit
          : 20,
      offset:
        typeof params?.offset === 'number' &&
        Number.isInteger(params.offset) &&
        params.offset >= 0
          ? params.offset
          : 0,
    };

    const profiles = await this.repos.agentProfiles.findPaged(pagination, {
      includeInactive: params?.include_inactive === true,
    });
    return {
      total: profiles.total,
      limit: pagination.limit,
      offset: pagination.offset,
      agent_profiles: profiles.data.map((profile) =>
        toAgentProfileRuntimeSummary(profile),
      ),
    };
  }

  async getAgentProfile(name: string): Promise<Record<string, unknown>> {
    const normalizedName = name.trim();
    const profile =
      await this.repos.agentProfiles.findByNameInsensitive(normalizedName);
    if (!profile?.is_active)
      return { found: false, name: normalizedName, agent_profile: null };
    return {
      found: true,
      name: normalizedName,
      agent_profile: toAgentProfileRuntimeSummary(profile),
    };
  }

  async listAgentProfileNames(): Promise<Record<string, unknown>> {
    const names = await this.repos.agentProfiles.findActiveNames();
    return {
      total: names.length,
      names,
    };
  }

  async checkPermission(params: {
    tool_name: string;
    payload: Record<string, unknown>;
    workflow_run_id?: string;
    job_id?: string;
    chat_session_id?: string;
    scope_id?: string;
    user?: AgentUserContext;
  }): Promise<Record<string, unknown>> {
    const governance = await this.runtimeCapabilityExecutor.checkPermission({
      capabilityName: params.tool_name,
      context: {
        workflow_run_id: params.workflow_run_id,
        job_id: params.job_id,
        chat_session_id: params.chat_session_id,
        user: params.user,
      },
      payload: params.payload,
    });
    return {
      status: governance.status,
      reason: governance.reason,
      denied_reason_code: governance.deniedReasonCode,
    };
  }

  async executeInternalTool(params: {
    name: string;
    payload: Record<string, unknown>;
    workflow_run_id?: string;
    job_id?: string;
    scope_id?: string;
    user?: AgentUserContext;
  }): Promise<Record<string, unknown>> {
    const agentContext = parseAgentExecutionContext(params.user?.userId);
    const workflowRunId = resolveAuthoritativeWorkflowRunId(
      params.workflow_run_id,
      agentContext?.workflowRunId,
    );
    const jobId = resolveAuthoritativeJobId(params.job_id, agentContext?.jobId);
    const workflowRun =
      await this.rejectTerminalRunForRuntimeAction(workflowRunId);
    const context = await buildInternalToolContext({
      ...params,
      workflowRunStateVariables: workflowRun?.state_variables,
      authoritativeWorkflowRunId: workflowRunId,
      authoritativeJobId: jobId,
      findRunById: (id) => this.repos.runs.findById(id),
    });
    const repairResult = await this.toolContractRepair.repair({
      toolName: params.name,
      payload: params.payload,
      workflowRunId,
      jobId,
    });
    const repairedPayload = repairResult.payload;
    const result = await this.runtimeCapabilityExecutor.execute({
      capabilityName: params.name,
      context: {
        workflow_run_id: workflowRunId,
        job_id: jobId,
        user: params.user,
      },
      payload: repairedPayload,
      execute: () =>
        this.internalToolRegistry.executeTool(
          params.name,
          context,
          repairedPayload,
        ),
    });

    if (!isRecord(result)) {
      return {};
    }
    if (repairResult.repairs.length === 0) {
      return result;
    }

    const repairedFields = repairResult.repairs
      .map((entry) => `'${entry.field}'`)
      .join(', ');
    return {
      ...result,
      system_note:
        `System Note: Your last call to ${params.name} used stringified JSON values for ${repairedFields}. ` +
        'They were auto-repaired this time. Use native objects/arrays instead of JSON strings in future calls.',
    };
  }

  /**
   * Resolves active standing orders for the given scope so agents receive
   * persistent operator policy alongside their callable tools. Standing orders
   * are advisory runtime context, so a resolution failure must never block
   * capability discovery — it degrades to an empty list with a logged warning.
   */
  private async resolveStandingOrders(
    scopeId?: string | null,
    profileName?: string | null,
  ): Promise<RuntimeStandingOrderView[]> {
    if (!scopeId) {
      return [];
    }
    try {
      return await this.standingOrders.getRuntimeStandingOrders(
        scopeId,
        profileName ?? undefined,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to resolve standing orders for scope ${scopeId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async requireRun(workflowRunId: string) {
    const run = await this.repos.runs.findById(workflowRunId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${workflowRunId} not found`);
    }
    return run;
  }

  private async rejectTerminalRunForRuntimeAction(
    workflowRunId: string | undefined,
  ): Promise<{ status?: unknown; state_variables?: unknown } | null> {
    if (!workflowRunId) {
      return null;
    }
    const run = await this.requireRun(workflowRunId);
    if (isTerminalWorkflowRunStatus(run.status)) {
      throw new ConflictException(
        `Workflow run ${workflowRunId} has terminal status ${run.status}`,
      );
    }
    return run;
  }
}
