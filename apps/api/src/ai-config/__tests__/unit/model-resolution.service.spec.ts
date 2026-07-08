import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAiConfigTestingModuleWithDefaults } from '../setup/ai-config-test.module';
import { AiConfigTestContext } from '../setup/ai-config-test.module';

describe('AiConfigurationService - Model Resolution', () => {
  let ctx: AiConfigTestContext;

  beforeEach(async () => {
    ctx = await createAiConfigTestingModuleWithDefaults({
      MODEL: 'env-model',
      DISTILLATION_MODEL: 'env-distill',
      SUMMARIZATION_MODEL: 'env-summary',
      SESSION_MODEL: 'env-session',
      SECRET_ENCRYPTION_KEY: 'test-encryption-key',
      JWT_SECRET: 'test-jwt-secret',
    });
  });

  describe('getModelForUseCase', () => {
    it('falls back to environment model when DB default is missing', async () => {
      ctx.llmModelRepository.findDefaultForUseCase.mockResolvedValue(null);
      ctx.modelSelectionFactory.selectModel.mockImplementation(
        (useCase: string) =>
          Promise.resolve(
            useCase === 'distillation' ? 'env-distill' : 'env-model',
          ),
      );

      const model = await ctx.service.getModelForUseCase('distillation');
      expect(model).toBe('env-distill');
    });
  });
});
