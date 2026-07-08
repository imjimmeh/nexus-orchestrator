import { Injectable } from '@nestjs/common';
import { asRecord } from '@nexus/core';
import { AgentSkillsService } from '../ai-config/services/agent-skills.service';
import type { SkillLibraryRecord } from '../ai-config/services/agent-skill-library.service.types';
import { AgentProfileSkillBindingService } from '../ai-config/services/agent-profile-skill-binding.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import {
  type WorkflowLifecycleStage,
  type WorkflowStageSkillPolicySource,
  type WorkflowStageSkillPolicyProfileRule,
  type WorkflowStageSkillSelection,
} from './workflow-stage-skill-policy.service.types';
import {
  normalizeSkillName,
  normalizeSkillNameList,
  normalizeProfileIdentifier,
  readFirstString,
  readStringArray,
  normalizeLifecycleStage,
  resolveStageFromJobIdentifier,
} from './workflow-stage-skill-policy.helpers';

const WORKFLOW_STAGE_SKILL_POLICY_KEY = 'workflow_stage_skill_policy';

interface ResolvedPolicyRule {
  rule: WorkflowStageSkillPolicyProfileRule | null;
  invalidPolicy: boolean;
}

@Injectable()
export class WorkflowStageSkillPolicyService {
  constructor(
    private readonly agentSkills: AgentSkillsService,
    private readonly settings: SystemSettingsService,
    private readonly profileSkillBindings: AgentProfileSkillBindingService,
  ) {}

  resolveLifecycleStage(
    stateVariables: Record<string, unknown> | undefined,
  ): WorkflowLifecycleStage | null {
    if (!stateVariables || typeof stateVariables !== 'object') {
      return null;
    }

    const trigger = asRecord(stateVariables.trigger);
    return (
      this.resolveDirectLifecycleStage(stateVariables, trigger) ??
      this.resolveStageFromInternalContext(stateVariables)
    );
  }

  async resolveAssignedSkills(params: {
    agentProfile?: string;
    workflowStage?: WorkflowLifecycleStage | null;
    stateVariables?: Record<string, unknown>;
    scopeId?: string;
    workflowId?: string;
  }): Promise<WorkflowStageSkillSelection> {
    const agentProfile = params.agentProfile?.trim();
    const stage =
      params.workflowStage ?? this.resolveLifecycleStage(params.stateVariables);

    if (!agentProfile) {
      return this.buildSelection({
        stage,
        policySource: 'profile',
        fallbackToProfileSkills: true,
        policyMatched: false,
        missingOrInvalidPolicy: false,
        skills: [],
      });
    }

    const profileSkills = await this.resolveBaseSkillSet(
      agentProfile,
      params.scopeId,
      params.workflowId,
    );

    if (!stage) {
      return this.buildSelection({
        stage,
        policySource: 'profile',
        fallbackToProfileSkills: true,
        policyMatched: false,
        missingOrInvalidPolicy: false,
        skills: profileSkills,
      });
    }

    const resolvedRule = await this.resolvePolicyRule(stage, agentProfile);
    if (resolvedRule.invalidPolicy) {
      return this.buildSelection({
        stage,
        policySource: 'invalid_policy',
        fallbackToProfileSkills: true,
        policyMatched: false,
        missingOrInvalidPolicy: true,
        skills: profileSkills,
      });
    }

    if (!resolvedRule.rule) {
      return this.buildSelection({
        stage,
        policySource: 'profile',
        fallbackToProfileSkills: true,
        policyMatched: false,
        missingOrInvalidPolicy: true,
        skills: profileSkills,
      });
    }

    const fallbackToProfileSkills =
      resolvedRule.rule.fallback_to_profile_skills !== false;
    const includeSkillNames = normalizeSkillNameList(
      resolvedRule.rule.include_skills,
    );
    const excludeSkillNames = normalizeSkillNameList(
      resolvedRule.rule.exclude_skills,
    );
    const selectedSkills = this.applyPolicyToSkills({
      profileSkills,
      includeSkillNames,
      excludeSkillNames,
      fallbackToProfileSkills,
    });

    return this.buildSelection({
      stage,
      policySource: fallbackToProfileSkills
        ? 'stage_policy_with_profile_fallback'
        : 'stage_policy',
      fallbackToProfileSkills,
      policyMatched: true,
      missingOrInvalidPolicy: false,
      includedSkillNames: includeSkillNames,
      excludedSkillNames: excludeSkillNames,
      skills: selectedSkills,
    });
  }

  private async resolveBaseSkillSet(
    agentProfile: string,
    scopeId?: string,
    workflowId?: string,
  ): Promise<SkillLibraryRecord[]> {
    const assignedGlobal = (
      await this.agentSkills.listSkillsByProfileName(agentProfile)
    ).filter((skill) => !skill.scope);

    const scoped = await this.agentSkills.listSkillsForScope({
      scopeId,
      agentProfile,
      workflowId,
    });

    const boundNames = await this.profileSkillBindings.listApplicableSkillNames(
      {
        scopeNodeId: scopeId,
        agentProfileName: agentProfile,
      },
    );
    const normalizedBoundNames = normalizeSkillNameList(boundNames);
    const boundSkills =
      normalizedBoundNames.length > 0
        ? this.agentSkills
            .listSkills()
            .filter((skill) =>
              normalizedBoundNames.includes(normalizeSkillName(skill.name)),
            )
        : [];

    // Scoped/bound variants take precedence over global when names collide
    const byName = new Map<string, SkillLibraryRecord>();
    for (const skill of [...assignedGlobal, ...scoped, ...boundSkills]) {
      byName.set(normalizeSkillName(skill.name), skill);
    }
    return [...byName.values()];
  }

  private buildSelection(params: {
    stage: WorkflowLifecycleStage | null;
    policySource: WorkflowStageSkillPolicySource;
    fallbackToProfileSkills: boolean;
    policyMatched: boolean;
    missingOrInvalidPolicy: boolean;
    skills: SkillLibraryRecord[];
    includedSkillNames?: string[];
    excludedSkillNames?: string[];
  }): WorkflowStageSkillSelection {
    return {
      ...params,
      includedSkillNames: params.includedSkillNames ?? [],
      excludedSkillNames: params.excludedSkillNames ?? [],
    };
  }

  private readStageCandidates(
    values: unknown[],
  ): WorkflowLifecycleStage | null {
    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }

      const stage = normalizeLifecycleStage(value);
      if (stage) {
        return stage;
      }
    }

    return null;
  }

  private resolveDirectLifecycleStage(
    stateVariables: Record<string, unknown>,
    trigger: Record<string, unknown> | null,
  ): WorkflowLifecycleStage | null {
    return this.readStageCandidates([
      stateVariables.lifecycle_stage,
      stateVariables.lifecycleStage,
      stateVariables.orchestration_stage,
      stateVariables.orchestrationStage,
      trigger?.lifecycle_stage,
      trigger?.lifecycleStage,
      trigger?.orchestration_stage,
      trigger?.orchestrationStage,
      trigger?.workflowStage,
      trigger?.workflow_stage,
      trigger?.dispatch_target_stage,
      trigger?.dispatchTargetStage,
    ]);
  }

  private resolveStageFromInternalContext(
    stateVariables: Record<string, unknown>,
  ): WorkflowLifecycleStage | null {
    const internalState = asRecord(stateVariables._internal);
    const currentJobId = readFirstString([
      internalState?.current_job_id,
      stateVariables.current_job_id,
    ]);

    return this.resolveStageFromJobId(currentJobId);
  }

  private resolveStageFromJobId(
    jobId: string | undefined,
  ): WorkflowLifecycleStage | null {
    return resolveStageFromJobIdentifier(jobId);
  }

  private async resolvePolicyRule(
    stage: WorkflowLifecycleStage,
    agentProfile: string,
  ): Promise<ResolvedPolicyRule> {
    const policy = await this.settings.get<unknown>(
      WORKFLOW_STAGE_SKILL_POLICY_KEY,
      {},
    );

    if (!asRecord(policy)) {
      return {
        rule: null,
        invalidPolicy: true,
      };
    }

    const stagePolicy = this.resolveStagePolicyEntry(policy, stage);
    if (!stagePolicy) {
      return {
        rule: null,
        invalidPolicy: false,
      };
    }

    const profileRule = this.resolveProfileRule(stagePolicy, agentProfile);
    if (!profileRule) {
      return {
        rule: null,
        invalidPolicy: false,
      };
    }

    const includeSkills = readStringArray(profileRule.include_skills);
    const excludeSkills = readStringArray(profileRule.exclude_skills);
    if (includeSkills.invalid || excludeSkills.invalid) {
      return {
        rule: null,
        invalidPolicy: true,
      };
    }

    return {
      rule: {
        include_skills: includeSkills.values,
        exclude_skills: excludeSkills.values,
        fallback_to_profile_skills:
          profileRule.fallback_to_profile_skills === false ? false : undefined,
      },
      invalidPolicy: false,
    };
  }

  private resolveStagePolicyEntry(
    rawPolicy: unknown,
    stage: WorkflowLifecycleStage,
  ): Record<string, unknown> | null {
    const policy = asRecord(rawPolicy);
    if (!policy) {
      return null;
    }

    for (const [key, value] of Object.entries(policy)) {
      const normalizedKey = normalizeLifecycleStage(key);
      if (normalizedKey !== stage) {
        continue;
      }

      const entry = asRecord(value);
      if (!entry) {
        return null;
      }

      return entry;
    }

    return null;
  }

  private resolveProfileRule(
    stagePolicy: Record<string, unknown>,
    agentProfile: string,
  ): Record<string, unknown> | null {
    const profileKey = normalizeProfileIdentifier(agentProfile);

    for (const [key, value] of Object.entries(stagePolicy)) {
      const normalizedKey = normalizeProfileIdentifier(key);
      if (normalizedKey !== profileKey && normalizedKey !== '*') {
        continue;
      }

      const rule = asRecord(value);
      if (!rule) {
        return null;
      }

      return rule;
    }

    return null;
  }

  private applyPolicyToSkills(params: {
    profileSkills: SkillLibraryRecord[];
    includeSkillNames: string[];
    excludeSkillNames: string[];
    fallbackToProfileSkills: boolean;
  }): SkillLibraryRecord[] {
    const allActiveSkills = this.agentSkills.listSkills();
    const skillsByName = new Map<string, SkillLibraryRecord>(
      allActiveSkills.map((skill) => [normalizeSkillName(skill.name), skill]),
    );

    const selected = new Map<string, SkillLibraryRecord>();

    if (params.fallbackToProfileSkills) {
      for (const skill of params.profileSkills) {
        selected.set(normalizeSkillName(skill.name), skill);
      }
    }

    for (const skillName of params.includeSkillNames) {
      const skill = skillsByName.get(skillName);
      if (!skill) {
        continue;
      }

      selected.set(skillName, skill);
    }

    for (const skillName of params.excludeSkillNames) {
      selected.delete(skillName);
    }

    return [...selected.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
