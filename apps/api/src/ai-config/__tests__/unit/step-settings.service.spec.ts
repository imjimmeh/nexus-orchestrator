import { describe, it, expect, beforeEach } from 'vitest';
import { createAiConfigTestingModuleWithDefaults } from '../setup/ai-config-test.module';
import { AiConfigTestContext } from '../setup/ai-config-test.module';
import {
  createMockAgentProfileFixture,
  createMockLegacyAgentProfileFixture,
  createMockLlmModelFixture,
} from '../setup/ai-config-test.fixtures';

describe('AiConfigurationService - Step Settings Resolution', () => {
  let ctx: AiConfigTestContext;

  beforeEach(async () => {
    ctx = await createAiConfigTestingModuleWithDefaults();
  });

  describe('resolveStepSettings', () => {
    it('resolves step settings with explicit values taking precedence', async () => {
      ctx.agentProfileRepository.findByName.mockResolvedValue(
        createMockAgentProfileFixture(),
      );
      ctx.llmModelRepository.findDefaultForUseCase.mockResolvedValue(
        createMockLlmModelFixture('execution'),
      );

      const resolved = await ctx.service.resolveStepSettings({
        explicitModel: 'explicit-model',
        explicitSystemPrompt: 'explicit-prompt',
        explicitProviderName: 'explicit-provider',
        agentProfileName: 'qa_automation',
      });

      expect(resolved).toEqual({
        model: 'explicit-model',
        systemPrompt: 'explicit-prompt',
        providerName: 'explicit-provider',
      });
    });

    it('keeps configured provider and model values unchanged from profile', async () => {
      ctx.agentProfileRepository.findByName.mockResolvedValue(
        createMockLegacyAgentProfileFixture(),
      );
      ctx.llmModelRepository.findDefaultForUseCase.mockResolvedValue(
        createMockLlmModelFixture('execution'),
      );

      const resolved = await ctx.service.resolveStepSettings({
        agentProfileName: 'testing-agent',
      });

      expect(resolved).toEqual({
        model: 'MiniMaxAI/MiniMax-M2.5-TEE',
        systemPrompt: 'legacy-prompt',
        providerName: 'chutes.ai',
      });
    });
  });
});
