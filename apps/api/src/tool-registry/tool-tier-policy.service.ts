import { Injectable } from '@nestjs/common';
import { ContainerTier, IToolRegistry } from '@nexus/core';

const TIER_ORDER: Record<ContainerTier, number> = {
  [ContainerTier.LIGHT]: 1,
  [ContainerTier.HEAVY]: 2,
};

@Injectable()
export class ToolTierPolicyService {
  filterToolsForTier(
    tools: IToolRegistry[],
    runtimeTier: ContainerTier,
  ): IToolRegistry[] {
    return tools.filter((tool) => this.canAccess(tool, runtimeTier));
  }

  canAccess(
    tool: Pick<IToolRegistry, 'tier_restriction'>,
    tier: ContainerTier,
  ): boolean {
    const currentTier = TIER_ORDER[tier] ?? TIER_ORDER[ContainerTier.LIGHT];
    const requiredTier = tool.tier_restriction ?? 0;
    return requiredTier <= currentTier;
  }
}
