import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AiConfigModule } from './ai-config.module';
import {
  AgentProfilesController,
  AgentSkillsController,
  FallbackChainsController,
  ModelsController,
  ProvidersController,
  SecretsController,
} from './controllers';

describe('AiConfigModule', () => {
  it('registers entity-specific controllers without duplicate aggregate routes', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      AiConfigModule,
    );

    expect(controllers).toEqual([
      ProvidersController,
      ModelsController,
      AgentProfilesController,
      AgentSkillsController,
      SecretsController,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      FallbackChainsController,
    ]);
  });
});
