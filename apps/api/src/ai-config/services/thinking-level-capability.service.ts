import { Injectable } from '@nestjs/common';
import type { RunnerThinkingLevel } from '@nexus/core';
import { parseThinkingLevel } from '@nexus/core';

@Injectable()
export class ThinkingLevelCapabilityService {
  async getSupportedLevels(input: {
    provider: string;
    modelId: string;
    thinkingLevelMap?: Partial<Record<RunnerThinkingLevel, string | null>>;
  }): Promise<RunnerThinkingLevel[]> {
    const fromSdk = await this.fromPiSdk(input.provider, input.modelId);
    if (fromSdk) return fromSdk;
    if (input.thinkingLevelMap) return this.fromMap(input.thinkingLevelMap);
    return [];
  }

  private async fromPiSdk(
    provider: string,
    modelId: string,
  ): Promise<RunnerThinkingLevel[] | undefined> {
    try {
      const { getModel, getSupportedThinkingLevels } =
        await import('@earendil-works/pi-ai');
      const model = getModel(provider as never, modelId as never);
      if (!model) return undefined;
      return getSupportedThinkingLevels(model)
        .map(parseThinkingLevel)
        .filter((l): l is RunnerThinkingLevel => l !== undefined);
    } catch {
      return undefined;
    }
  }

  private fromMap(
    map: Partial<Record<RunnerThinkingLevel, string | null>>,
  ): RunnerThinkingLevel[] {
    return (Object.entries(map) as Array<[RunnerThinkingLevel, string | null]>)
      .filter(([, value]) => value !== null)
      .map(([level]) => level);
  }
}
