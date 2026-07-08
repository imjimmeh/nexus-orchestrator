import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ContainerTier, ToolPolicyEffect } from '@nexus/core';
import { AgentProfileRepository } from '../ai-config/database/repositories/agent-profile.repository';
import { ToolPolicyEvaluatorService } from '../capability-governance/tool-policy-evaluator.service';

export type { IAgentProfile } from './iam-policy.service.types';
import type { IAgentProfile } from './iam-policy.service.types';

@Injectable()
export class IAMPolicyService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IAMPolicyService.name);

  private profiles: Record<string, IAgentProfile> = {};

  constructor(
    private readonly agentProfiles: AgentProfileRepository,
    private readonly toolPolicyEvaluator: ToolPolicyEvaluatorService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.refreshPolicies();
  }

  async refreshPolicies(): Promise<void> {
    const profiles = await this.agentProfiles.findAll();
    const activeProfiles = profiles.filter((profile) => profile.is_active);
    const nextProfiles: Record<string, IAgentProfile> = {};

    for (const profile of activeProfiles) {
      if (!profile.name) {
        continue;
      }

      nextProfiles[profile.name] = {
        name: profile.name,
        tier:
          profile.tier_preference === 'light'
            ? ContainerTier.LIGHT
            : ContainerTier.HEAVY,
        toolPolicy: profile.tool_policy ?? undefined,
      };
    }

    this.profiles = nextProfiles;
    this.logger.log(
      `Loaded ${activeProfiles.length.toString()} active IAM profiles from database`,
    );
  }

  evaluateAccess(profileName: string, toolName: string): boolean {
    const profile = this.profiles[profileName];
    if (!profile) {
      this.logger.warn(`Access denied: Unknown profile ${profileName}`);
      return false;
    }

    if (!profile.toolPolicy) {
      this.logger.warn(
        `Access denied: Profile ${profileName} has no tool policy defined`,
      );
      return false;
    }

    const decision = this.toolPolicyEvaluator.evaluate(
      toolName,
      {},
      profile.toolPolicy,
    );
    const isAllowed = decision.effect === ToolPolicyEffect.ALLOW;

    if (!isAllowed) {
      this.logger.warn(
        `Access denied: Profile ${profileName} attempted to use unauthorized tool ${toolName}. Reason: ${decision.explanation ?? ''}`,
      );
    }
    return isAllowed;
  }

  getProfile(name: string): IAgentProfile | undefined {
    return this.profiles[name];
  }
}
