import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderCredentialService } from './provider-credential.service';
import type { LlmProvider } from '../database/entities/llm-provider.entity';

function makeSecrets() {
  return {
    create: vi.fn().mockResolvedValue({ id: 'secret-1', name: 'x' }),
    update: vi.fn().mockResolvedValue({ id: 'secret-1', name: 'x' }),
    findByIdRaw: vi.fn(),
  };
}

describe('ProviderCredentialService.applyOnCreate', () => {
  let secrets: ReturnType<typeof makeSecrets>;
  let service: ProviderCredentialService;

  beforeEach(() => {
    secrets = makeSecrets();
    service = new ProviderCredentialService(secrets as never);
  });

  it('passes through unchanged when no credential is present', async () => {
    const data = { name: 'OpenAI', secret_id: 'existing' } as never;
    expect(await service.applyOnCreate(data)).toBe(data);
    expect(secrets.create).not.toHaveBeenCalled();
  });

  it('creates a managed secret and wires secret_id + runtime_env', async () => {
    const result = await service.applyOnCreate({
      name: 'OpenAI',
      provider_id: 'openai',
      auth_type: 'api_key',
      credential: {
        api_key: 'sk-test',
        extra: { ORG_ID: 'org_1' },
        headers: [{ name: 'X-Title', value: 'nexus' }],
      },
    });

    expect(secrets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        value: { OPENAI_API_KEY: 'sk-test', ORG_ID: 'org_1' },
        metadata: {
          managed_by_provider: true,
          fields: ['ORG_ID', 'OPENAI_API_KEY'],
        },
      }),
    );
    expect(result.secret_id).toBe('secret-1');
    expect(result.credential).toBeUndefined();
    expect(result.runtime_env).toEqual({
      api_key_field: 'OPENAI_API_KEY',
      providerConfig: { headers: { 'X-Title': 'nexus' } },
    });
  });

  it('throws when the credential produces an empty secret', async () => {
    await expect(
      service.applyOnCreate({
        name: 'OpenAI',
        provider_id: 'openai',
        auth_type: 'api_key',
        credential: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ProviderCredentialService.applyOnUpdate', () => {
  let secrets: ReturnType<typeof makeSecrets>;
  let service: ProviderCredentialService;

  beforeEach(() => {
    secrets = makeSecrets();
    service = new ProviderCredentialService(secrets as never);
  });

  it('merges changed keys into the existing secret, keeping the api key when blank', async () => {
    secrets.findByIdRaw.mockResolvedValue({
      id: 'secret-1',
      decryptedValue: JSON.stringify({ OPENAI_API_KEY: 'sk-old', ORG_ID: 'a' }),
    });
    const existing = {
      id: 'p1',
      provider_id: 'openai',
      secret_id: 'secret-1',
      runtime_env: { pi_provider: 'openai' },
    } as unknown as LlmProvider;

    const result = await service.applyOnUpdate(
      { credential: { extra: { ORG_ID: 'b' } } },
      existing,
    );

    expect(secrets.update).toHaveBeenCalledWith(
      'secret-1',
      expect.objectContaining({
        value: { OPENAI_API_KEY: 'sk-old', ORG_ID: 'b' },
      }),
    );
    expect(result.secret_id).toBe('secret-1');
    expect(result.credential).toBeUndefined();
    expect(result.runtime_env).toMatchObject({
      api_key_field: 'OPENAI_API_KEY',
    });
  });

  it('throws when credential is empty even if an existing secret is present', async () => {
    const existing = {
      id: 'p1',
      provider_id: 'openai',
      secret_id: 'secret-1',
      runtime_env: { pi_provider: 'openai' },
    } as unknown as LlmProvider;

    await expect(
      service.applyOnUpdate({ credential: {} }, existing),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(secrets.findByIdRaw).not.toHaveBeenCalled();
    expect(secrets.update).not.toHaveBeenCalled();
  });
});
