import { Injectable } from '@nestjs/common';
import type { RunnerThinkingLevel } from '@nexus/core';
import { clampThinkingLevel, resolveThinkingLevel } from '@nexus/core';
import { ThinkingLevelCapabilityService } from './thinking-level-capability.service';
import type { ThinkingLevelResolution } from './thinking-level-resolver.service.types';

@Injectable()
export class ThinkingLevelResolver {
  constructor(private readonly capability: ThinkingLevelCapabilityService) {}

  async resolve(input: {
    stepInput?: RunnerThinkingLevel;
    agentProfile?: RunnerThinkingLevel;
    modelDefault?: RunnerThinkingLevel;
    provider: string;
    modelId: string;
    thinkingLevelMap?: Partial<Record<RunnerThinkingLevel, string | null>>;
    harnessSupportsThinkingLevels: boolean;
  }): Promise<ThinkingLevelResolution> {
    const requested = resolveThinkingLevel({
      stepInput: input.stepInput,
      agentProfile: input.agentProfile,
      modelDefault: input.modelDefault,
    });
    if (!requested) return { dropped: false };
    if (!input.harnessSupportsThinkingLevels) return { dropped: true };

    const supported = await this.capability.getSupportedLevels({
      provider: input.provider,
      modelId: input.modelId,
      thinkingLevelMap: input.thinkingLevelMap,
    });
    const effective = clampThinkingLevel(requested, supported);
    if (!effective) return { dropped: true };
    return effective === requested
      ? { level: effective }
      : { level: effective, clampedFrom: requested };
  }
}
