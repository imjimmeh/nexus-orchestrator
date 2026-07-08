import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { seedLlmSecret } from './llm-secret.seed';

describe('seedLlmSecret', () => {
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
    delete process.env.SEED_LLM_SECRET_FROM_ENV;
    delete process.env.E2E_PROVIDER_API_KEY;
    delete process.env.E2E_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it('returns null when env seeding is not enabled', async () => {
    const result = await seedLlmSecret(dataSource);

    expect(result).toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('creates secret when enabled and api key exists', async () => {
    process.env.SEED_LLM_SECRET_FROM_ENV = 'true';
    process.env.E2E_PROVIDER_API_KEY = 'seed-key';
    repository.findOne.mockResolvedValue(null);
    repository.save.mockResolvedValue({ id: 'secret-1' });

    const expectedSecretName =
      process.env.E2E_PROVIDER_SECRET_NAME ||
      `${process.env.E2E_PROVIDER_NAME || 'chutes.ai'}-seed-secret`;

    const result = await seedLlmSecret(dataSource);

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { name: expectedSecretName, owner_type: 'global' },
    });
    expect(result).toBe('secret-1');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expectedSecretName,
      }),
    );
  });

  it('updates an existing secret', async () => {
    process.env.SEED_LLM_SECRET_FROM_ENV = 'true';
    process.env.E2E_PROVIDER_API_KEY = 'seed-key';
    repository.findOne.mockResolvedValue({ id: 'secret-existing' });
    repository.save.mockResolvedValue({ id: 'secret-existing' });

    const expectedSecretName =
      process.env.E2E_PROVIDER_SECRET_NAME ||
      `${process.env.E2E_PROVIDER_NAME || 'chutes.ai'}-seed-secret`;

    const result = await seedLlmSecret(dataSource);

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { name: expectedSecretName, owner_type: 'global' },
    });
    expect(result).toBe('secret-existing');
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'secret-existing' }),
    );
  });
});
