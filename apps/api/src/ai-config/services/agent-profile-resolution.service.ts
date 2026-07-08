import { Injectable } from '@nestjs/common';
import type { HarnessContributions } from '@nexus/core';
import { ScopedConfigResolver } from '../../config-resolution/scoped-config-resolver.service';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';
import type { AgentProfile } from '../database/entities/agent-profile.entity';
import type { EffectiveConfig } from '../../config-resolution/effective-config.types';

@Injectable()
export class AgentProfileResolutionService {
  constructor(private readonly resolver: ScopedConfigResolver) {}

  resolve(
    name: string,
    scopeNodeId: string | null,
  ): Promise<EffectiveConfig<AgentProfile>> {
    return this.resolver.resolve<AgentProfile>(
      'agent_profile',
      name,
      scopeNodeId ?? GLOBAL_SCOPE_NODE_ID,
    );
  }

  /**
   * Resolve the precedence-merged profile and surface only its authored harness
   * contributions. Returns undefined for an unnamed profile or one with no
   * contributions, so callers can omit the bundle entirely when absent.
   */
  async resolveContributions(
    name: string | undefined,
    scopeNodeId: string | null,
  ): Promise<Partial<HarnessContributions> | undefined> {
    if (!name) return undefined;
    const effective = await this.resolve(name, scopeNodeId);
    return effective.value?.harness_contributions ?? undefined;
  }
}
