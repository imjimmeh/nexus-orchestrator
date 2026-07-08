import { Injectable } from '@nestjs/common';
import {
  ContainerTier,
  IJob,
  IToolPermissionPolicy,
  type SkillDiscoveryMode,
} from '@nexus/core';
import { CapabilityRegistryService } from '../capability-infra/capability-registry.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { StepSupportService } from '../workflow/workflow-step-execution/step-support.service';
import { normalizeToolPolicy } from '../workflow/workflow-step-execution/step-support.helpers';
import { ToolApprovalRuleService } from '../capability-governance/tool-approval-rule.service';
import { PolicyEngineService } from '../capability-governance/policy-engine.service';
import { ChatCapabilityContextValidator } from './chat-capability-context.validator';
import { OutputContractValidator } from './output-contract.validator';
import type { CapabilityManifestEntry } from '../capability-infra/capability-manifest.types';
import type {
  CandidateResolution,
  CapabilityDeniedReason,
  CapabilityPreflightResult,
  CapabilityResolutionSnapshot,
  ChatCapabilitySnapshotInput,
  PreflightInput,
  OrchestrationMode,
} from './capability-preflight.types';
import {
  buildMissingProjectContextReason,
  isCapabilityRegistered,
  resolveModeOutcome,
  selectRunnerRuntimeTools,
} from './capability-preflight.helpers';
import { asRecord, readString } from '@nexus/core';
import type { PolicyDecision } from '../capability-governance/policy-engine.service.types';

const SKILL_SEARCH_CAPABILITY = 'search_skills';

@Injectable()
export class CapabilityPreflightService {
  private readonly SDK_NATIVE_RUNNER_TOOLS = [
    'read',
    'write',
    'edit',
    'bash',
    'ls',
    'find',
    'grep',
  ];
  private readonly chatContextValidator = new ChatCapabilityContextValidator();
  private readonly contractValidator = new OutputContractValidator();

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly support: StepSupportService,
    private readonly ruleService: ToolApprovalRuleService,
    private readonly policyEngine: PolicyEngineService,
    private readonly capabilityRegistry: CapabilityRegistryService,
  ) {}

  async preflightJobExecution(
    params: PreflightInput,
  ): Promise<CapabilityPreflightResult> {
    const snapshot = await this.resolveCapabilitySnapshot(params);
    const callableSet = new Set<string>(snapshot.callableToolNames);
    const contractValidation = this.contractValidator.validateOutputContract(
      params.job,
      callableSet,
      snapshot,
    );
    if (contractValidation) {
      return contractValidation;
    }
    return { ...snapshot, ok: true };
  }

  async resolveCapabilitySnapshot(
    params: PreflightInput,
  ): Promise<CapabilityResolutionSnapshot> {
    const skillDiscoveryMode =
      await this.support.resolveSkillDiscoveryModeForJob({
        job: params.job,
        resolvedJobInputs: params.resolvedJobInputs,
        stateVariables: params.stateVariables,
        workflowMode: params.workflowSkillDiscoveryMode,
      });
    const candidateResolution = await this.resolveCandidateResolution(
      params.job,
      params.workflowPermissions,
      skillDiscoveryMode,
    );
    const allowedByPolicy = await this.resolveAllowedByPolicy(
      params,
      candidateResolution,
    );
    const scopeId = this.resolveScopeId(
      params.stateVariables,
      params.resolvedJobInputs,
    );
    const mode = await this.resolveOrchestrationMode(scopeId);
    const agentProfile = this.support.resolveAgentProfileFromJobInputs(
      params.resolvedJobInputs,
      params.job,
      params.stateVariables,
    );
    const approvalRequiredByProfile =
      await this.support.resolveApprovalRequiredToolNames({
        tools: Array.from(candidateResolution.candidateNames).map((name) => ({
          name,
        })),
        agentProfile: agentProfile ?? undefined,
      });
    const agentToolPolicy = await this.support.resolveAgentToolPolicy(
      agentProfile ?? undefined,
    );
    const classification = await this.classifyCandidateCapabilities({
      candidateNames: candidateResolution.candidateNames,
      selectedRegisteredTools: candidateResolution.selectedRegisteredTools,
      runnerRuntimeTools: candidateResolution.runnerRuntimeTools,
      allowedByPolicy,
      approvalRequiredByProfile,
      mode,
      ruleContext: {
        scopeId: scopeId ?? undefined,
        workflowRunId: params.workflowRunId,
        agentProfile: agentProfile ?? undefined,
      },
    });

    return {
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      scopeId,
      mode,
      callableToolNames: this.sortStringArray(classification.callable),
      denied: classification.denied,
      approvalRequiredToolNames: this.deduplicateAndSortStrings(
        classification.approvalRequiredToolNames,
      ),
      agentToolPolicy,
    };
  }

  async resolveChatCapabilitySnapshot(
    params: ChatCapabilitySnapshotInput,
  ): Promise<CapabilityResolutionSnapshot> {
    const toolsForTier = await this.toolRegistry.getToolsForTier(
      ContainerTier.LIGHT,
    );
    const candidateNames = new Set<string>(toolsForTier.map((t) => t.name));

    const agentProfile = params.agentProfileName;
    const normalizedScopeId = this.chatContextValidator.normalizeScopeId(
      params.scopeId,
    );
    const allowedByProfile = await this.support.resolveAllowedToolNames({
      tools: Array.from(candidateNames).map((name) => ({ name })),
      job: {
        id: 'chat',
        type: 'execution',
        tier: 'light',
      },
      workflowPermissions: undefined,
      agentProfile,
      policyStrategy: 'profile_only',
    });

    const mode = await this.resolveOrchestrationMode(params.scopeId ?? null);
    const approvalRequiredByProfile =
      await this.support.resolveApprovalRequiredToolNames({
        tools: Array.from(candidateNames).map((name) => ({ name })),
        agentProfile: agentProfile ?? undefined,
      });
    const agentToolPolicy = await this.support.resolveAgentToolPolicy(
      agentProfile ?? undefined,
    );

    const classification = await this.classifyCandidateCapabilities({
      candidateNames,
      selectedRegisteredTools: toolsForTier,
      runnerRuntimeTools: [],
      allowedByPolicy: allowedByProfile,
      approvalRequiredByProfile,
      mode,
      ruleContext: {
        scopeId: normalizedScopeId ?? undefined,
        chatSessionId: params.chatSessionId,
        agentProfile: agentProfile ?? undefined,
      },
    });

    return {
      workflowRunId: '',
      jobId: 'chat',
      scopeId: normalizedScopeId,
      mode,
      callableToolNames: this.sortStringArray(classification.callable),
      denied: classification.denied,
      approvalRequiredToolNames: this.deduplicateAndSortStrings(
        classification.approvalRequiredToolNames,
      ),
      agentToolPolicy,
    };
  }

  private async resolveCandidateResolution(
    job: IJob,
    workflowPermissions?: IToolPermissionPolicy,
    skillDiscoveryMode?: SkillDiscoveryMode,
  ): Promise<CandidateResolution> {
    const tier = this.support.getJobTier(job);
    const toolsForTier = await this.toolRegistry.getToolsForTier(tier);
    const selectedRegisteredTools = this.support.selectToolsForJob(
      toolsForTier,
      job,
    );
    const discoveredEntries = this.capabilityRegistry.getDiscoveredEntries();
    const runnerRuntimeTools = selectRunnerRuntimeTools(
      job,
      Array.from(
        new Set([
          ...discoveredEntries
            .filter(
              (entry: CapabilityManifestEntry) =>
                entry.runtimeOwner === 'runner',
            )
            .map((entry: CapabilityManifestEntry) => entry.name),
          ...this.SDK_NATIVE_RUNNER_TOOLS,
        ]),
      ),
    );
    const requestedApiCapabilities = this.resolveRequestedApiCapabilityNames(
      job,
      discoveredEntries,
      workflowPermissions,
      skillDiscoveryMode,
    );
    const candidateNames = new Set<string>([
      ...selectedRegisteredTools.map((tool) => tool.name),
      ...runnerRuntimeTools,
      ...requestedApiCapabilities,
      ...(job.output_contract ? ['set_job_output'] : []),
    ]);

    return {
      candidateNames,
      selectedRegisteredTools,
      runnerRuntimeTools,
    };
  }

  private resolveRequestedApiCapabilityNames(
    job: IJob,
    discoveredEntries: CapabilityManifestEntry[],
    workflowPermissions?: IToolPermissionPolicy,
    skillDiscoveryMode?: SkillDiscoveryMode,
  ): string[] {
    const requestedNames = new Set<string>();
    const addRequestedNames = (names: Iterable<string>): void => {
      for (const name of names) {
        if (name !== '*') {
          requestedNames.add(name);
        }
      }
    };

    // Check job.tools
    for (const name of job.tools ?? []) {
      requestedNames.add(name);
    }
    // Check job.permissions.allow_tools
    addRequestedNames(normalizeToolPolicy(job.permissions).allow);
    // Check workflowPermissions.allow_tools (for companion tools like wait_for_subagents
    // that may only be defined at workflow level)
    if (workflowPermissions) {
      addRequestedNames(normalizeToolPolicy(workflowPermissions).allow);
    }

    if (requestedNames.size === 0) {
      return [];
    }

    const names = discoveredEntries
      .filter(
        (entry: CapabilityManifestEntry) =>
          entry.runtimeOwner === 'api' && requestedNames.has(entry.name),
      )
      .map((entry: CapabilityManifestEntry) => entry.name);

    return skillDiscoveryMode === 'native'
      ? names.filter((name) => name !== SKILL_SEARCH_CAPABILITY)
      : names;
  }

  private async resolveAllowedByPolicy(
    params: PreflightInput,
    candidateResolution: CandidateResolution,
  ): Promise<Set<string>> {
    const candidateTools = Array.from(candidateResolution.candidateNames).map(
      (name) => ({ name }),
    );

    const agentProfile = this.support.resolveAgentProfileFromJobInputs(
      params.resolvedJobInputs,
      params.job,
      params.stateVariables,
    );

    return this.support.resolveAllowedToolNames({
      tools: candidateTools,
      job: params.job,
      workflowPermissions: params.workflowPermissions,
      agentProfile,
      policyStrategy: params.policyStrategy,
    });
  }
  private async classifyCandidateCapabilities(params: {
    candidateNames: Set<string>;
    selectedRegisteredTools: Array<{
      name: string;
      publication_status?: string | null;
    }>;
    runnerRuntimeTools: string[];
    allowedByPolicy: Set<string>;
    approvalRequiredByProfile: Set<string>;
    mode: OrchestrationMode | null;
    ruleContext: {
      scopeId?: string;
      workflowRunId?: string;
      chatSessionId?: string;
      agentProfile?: string;
    };
  }): Promise<{
    denied: CapabilityDeniedReason[];
    callable: string[];
    approvalRequiredToolNames: string[];
  }> {
    const denied: CapabilityDeniedReason[] = [];
    const callable: string[] = [];
    const approvalRequiredToolNames: string[] = [];

    for (const toolName of params.candidateNames) {
      const decision = await this.classifySingleCandidateCapability({
        toolName,
        selectedRegisteredTools: params.selectedRegisteredTools,
        runnerRuntimeTools: params.runnerRuntimeTools,
        allowedByPolicy: params.allowedByPolicy,
        approvalRequiredByProfile: params.approvalRequiredByProfile,
        mode: params.mode,
        ruleContext: params.ruleContext,
      });

      if (decision.status === 'deny') {
        if (decision.deniedReason) {
          denied.push(decision.deniedReason);
        }
        continue;
      }

      if (decision.status === 'approval_required') {
        approvalRequiredToolNames.push(toolName);
      }

      callable.push(toolName);
    }

    return {
      denied,
      callable,
      approvalRequiredToolNames,
    };
  }

  private async classifySingleCandidateCapability(params: {
    toolName: string;
    selectedRegisteredTools: Array<{
      name: string;
      publication_status?: string | null;
    }>;
    runnerRuntimeTools: string[];
    allowedByPolicy: Set<string>;
    approvalRequiredByProfile: Set<string>;
    mode: OrchestrationMode | null;
    ruleContext: {
      scopeId?: string;
      workflowRunId?: string;
      chatSessionId?: string;
      agentProfile?: string;
    };
  }): Promise<PolicyDecision> {
    const chatDenial = this.checkChatContextDenial(params);
    if (chatDenial) return chatDenial;

    const registryTool = params.selectedRegisteredTools.find(
      (tool) => tool.name === params.toolName,
    );
    const isRegistered = this.resolveIsRegistered(params);
    const manifestEntry = this.capabilityRegistry.getDiscoveredEntryByName(
      params.toolName,
    );

    const ruleEffect = await this.ruleService.resolveToolEffectPreflight(
      params.ruleContext,
      params.toolName,
    );
    const modeOutcome = resolveModeOutcome(
      params.mode,
      manifestEntry?.mutatingAction,
    );

    const profileDecision = this.resolveProfileDecision(params);

    return this.policyEngine.decide({
      capabilityName: params.toolName,
      isRegistered,
      publicationStatus: registryTool?.publication_status,
      profileDecision,
      modeOutcome: modeOutcome ?? 'unchecked',
      ruleEffect,
      approvalRequiredByProfile: profileDecision === 'approval_required',
    });
  }

  private resolveIsRegistered(params: {
    toolName: string;
    selectedRegisteredTools: Array<{ name: string }>;
    runnerRuntimeTools: string[];
  }): boolean {
    return (
      isCapabilityRegistered({
        toolName: params.toolName,
        selectedRegisteredTools: params.selectedRegisteredTools,
        runnerRuntimeTools: params.runnerRuntimeTools,
      }) ||
      this.capabilityRegistry.getDiscoveredEntryByName(params.toolName)
        ?.runtimeOwner === 'api'
    );
  }

  private resolveProfileDecision(params: {
    toolName: string;
    allowedByPolicy: Set<string>;
    approvalRequiredByProfile: Set<string>;
  }): 'allow' | 'deny' | 'approval_required' | 'unchecked' {
    const allowed = params.allowedByPolicy.has(params.toolName);
    if (!allowed) return 'unchecked';
    return params.approvalRequiredByProfile.has(params.toolName)
      ? 'approval_required'
      : 'allow';
  }

  private checkChatContextDenial(params: {
    toolName: string;
    mode: OrchestrationMode | null;
    ruleContext: {
      scopeId?: string;
      chatSessionId?: string;
    };
  }): PolicyDecision | null {
    const manifestEntry = this.capabilityRegistry.getDiscoveredEntryByName(
      params.toolName,
    );
    const isProjectScoped =
      this.chatContextValidator.isToolProjectScoped(manifestEntry);
    const hasProjectContext = !!params.ruleContext.scopeId;
    const isChat = !!params.ruleContext.chatSessionId;

    if (isProjectScoped && !hasProjectContext && isChat) {
      return {
        status: 'deny',
        deniedReason: buildMissingProjectContextReason(
          params.toolName,
          'chat_context',
        ),
        explanation: { phases: [], decidedBy: 'context_requirement' },
      };
    }
    return null;
  }

  private sortStringArray(items: string[]): string[] {
    return [...items].sort((a, b) => a.localeCompare(b));
  }

  private deduplicateAndSortStrings(items: string[]): string[] {
    return Array.from(new Set<string>(items)).sort((a, b) =>
      a.localeCompare(b),
    );
  }

  private resolveScopeId(
    stateVariables: Record<string, unknown>,
    resolvedJobInputs: Record<string, unknown>,
  ): string | null {
    const trigger = asRecord(stateVariables.trigger);
    const fromTrigger = readString(trigger?.scopeId);
    if (fromTrigger) {
      return fromTrigger;
    }

    const fromTriggerScopeId = readString(trigger?.scope_id);
    if (fromTriggerScopeId) {
      return fromTriggerScopeId;
    }

    const fromInputs = readString(resolvedJobInputs.scope_id);
    if (fromInputs) {
      return fromInputs;
    }

    return null;
  }

  private async resolveOrchestrationMode(
    scopeId: string | null,
  ): Promise<OrchestrationMode | null> {
    await Promise.resolve();
    if (!scopeId) {
      return null;
    }
    return null;
  }
}
