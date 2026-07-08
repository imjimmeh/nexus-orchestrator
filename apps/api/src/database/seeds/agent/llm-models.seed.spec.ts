import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { DEFAULT_LLM_MODELS, seedLlmModels } from './llm-models.seed';

describe('seedLlmModels', () => {
  const repository = {
    findOne: vi.fn(),
    create: vi.fn((value) => value),
    save: vi.fn(),
  };

  const dataSource = {
    getRepository: vi.fn(() => repository),
  } as unknown as DataSource;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the default models when missing', async () => {
    repository.findOne.mockResolvedValue(null);

    await seedLlmModels(dataSource);

    expect(repository.create).toHaveBeenCalledWith(DEFAULT_LLM_MODELS[0]);
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('does not update an existing model', async () => {
    repository.findOne
      .mockResolvedValueOnce({
        id: 'model-1',
        name: 'MiniMaxAI/MiniMax-M2.5-TEE',
        provider_name: 'custom',
        token_limit: 1,
        default_for_execution: false,
        default_for_distillation: false,
        default_for_summarization: false,
        default_for_session: false,
        is_active: false,
      })
      .mockResolvedValueOnce(DEFAULT_LLM_MODELS[0]);

    await seedLlmModels(dataSource);

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('never seeds more than one default_for_execution model', () => {
    const defaultForExecutionCount = DEFAULT_LLM_MODELS.filter(
      (model) => model.default_for_execution,
    ).length;

    expect(defaultForExecutionCount).toBeLessThanOrEqual(1);
  });
});
