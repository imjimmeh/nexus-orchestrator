import { describe, expect, it, vi } from 'vitest';
import type { AiConfigAdminService } from '../ai-config-admin.service';
import type { AiConfigurationService } from '../ai-configuration.service';
import type { AgentProfileResolutionService } from '../services/agent-profile-resolution.service';
import { ModelsInternalController } from './models-internal.controller';

describe('ModelsInternalController', () => {
  it("getRates returns the admin service's active model rates", async () => {
    const rates = [
      {
        modelId: 'model-1',
        providerName: 'anthropic',
        modelName: 'claude-sonnet-5',
        inputTokenCentsPerMillion: 300,
        outputTokenCentsPerMillion: 1500,
      },
    ];
    const aiConfigAdmin = {
      getActiveModelRates: vi.fn().mockResolvedValue(rates),
    } as unknown as AiConfigAdminService;
    const controller = new ModelsInternalController(
      aiConfigAdmin,
      {} as any,
      {} as any,
    );

    await expect(controller.getRates()).resolves.toEqual({ rates });
  });

  describe('resolveModel', () => {
    it('returns resolved model name and provider from effective profile when configured', async () => {
      const mockProfile = {
        value: {
          model_name: 'gpt-4o',
          provider_name: 'openai',
        },
      };
      const profileResolution = {
        resolve: vi.fn().mockResolvedValue(mockProfile),
      } as unknown as AgentProfileResolutionService;
      const aiConfigurationService = {} as unknown as AiConfigurationService;

      const controller = new ModelsInternalController(
        {} as any,
        aiConfigurationService,
        profileResolution,
      );

      const result = await controller.resolveModel('senior_dev', 'proj-1');
      expect(result).toEqual({
        modelName: 'gpt-4o',
        providerName: 'openai',
      });
      expect(profileResolution.resolve).toHaveBeenCalledWith(
        'senior_dev',
        'proj-1',
      );
    });

    it('falls back to default execution model and looks up its provider when agent profile resolution returns null model_name', async () => {
      const mockProfile = {
        value: {
          model_name: null,
          provider_name: null,
        },
      };
      const profileResolution = {
        resolve: vi.fn().mockResolvedValue(mockProfile),
      } as unknown as AgentProfileResolutionService;

      const aiConfigurationService = {
        getModelForUseCase: vi.fn().mockResolvedValue('default-exec-model'),
        getModelByName: vi
          .fn()
          .mockResolvedValue({ provider_name: 'default-provider' }),
      } as unknown as AiConfigurationService;

      const controller = new ModelsInternalController(
        {} as any,
        aiConfigurationService,
        profileResolution,
      );

      const result = await controller.resolveModel('senior_dev', 'proj-1');
      expect(result).toEqual({
        modelName: 'default-exec-model',
        providerName: 'default-provider',
      });
      expect(profileResolution.resolve).toHaveBeenCalledWith(
        'senior_dev',
        'proj-1',
      );
      expect(aiConfigurationService.getModelForUseCase).toHaveBeenCalledWith(
        'execution',
      );
      expect(aiConfigurationService.getModelByName).toHaveBeenCalledWith(
        'default-exec-model',
      );
    });

    it('falls back to default execution model when agentProfileName is not provided', async () => {
      const profileResolution = {
        resolve: vi.fn(),
      } as unknown as AgentProfileResolutionService;

      const aiConfigurationService = {
        getModelForUseCase: vi.fn().mockResolvedValue('default-exec-model'),
        getModelByName: vi
          .fn()
          .mockResolvedValue({ provider_name: 'default-provider' }),
      } as unknown as AiConfigurationService;

      const controller = new ModelsInternalController(
        {} as any,
        aiConfigurationService,
        profileResolution,
      );

      const result = await controller.resolveModel(undefined, undefined);
      expect(result).toEqual({
        modelName: 'default-exec-model',
        providerName: 'default-provider',
      });
      expect(profileResolution.resolve).not.toHaveBeenCalled();
      expect(aiConfigurationService.getModelForUseCase).toHaveBeenCalledWith(
        'execution',
      );
    });
  });
});
