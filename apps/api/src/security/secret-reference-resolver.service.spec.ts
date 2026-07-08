import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SecretReferenceResolver } from './secret-reference-resolver.service';
import type { SecretCrudService } from './services/secret-crud.service';

describe('SecretReferenceResolver', () => {
  const buildService = (secretCrud: Partial<SecretCrudService>) =>
    new SecretReferenceResolver(secretCrud as SecretCrudService);

  it('throws a BadRequestException when a referenced secret does not exist', async () => {
    const service = buildService({
      findByIdRaw: vi.fn().mockResolvedValue(null),
    });

    await expect(
      service.assertSecretExists(
        '99999999-9999-4999-8999-999999999999',
        'headers',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('resolves map secrets from decrypted JSON object values', async () => {
    const service = buildService({
      findByIdRaw: vi.fn().mockResolvedValue({
        id: '88888888-8888-4888-8888-888888888888',
        decryptedValue: JSON.stringify({ authorization: 'Bearer secret' }),
      }),
    });

    await expect(
      service.resolveMap({
        secretId: '88888888-8888-4888-8888-888888888888',
        plaintext: { authorization: 'Bearer plain' },
        purpose: 'headers',
        serverName: 'External MCP',
      }),
    ).resolves.toEqual({ authorization: 'Bearer secret' });
  });

  it('redacts plaintext credential fields when secret references are present', () => {
    const service = buildService({});
    const server = {
      auth_secret_id: '99999999-9999-4999-8999-999999999999',
      auth_token: 'plain-token',
      headers_secret_id: '88888888-8888-4888-8888-888888888888',
      headers: { authorization: 'Bearer plain' },
      env_secret_id: '77777777-7777-4777-8777-777777777777',
      env: { LOG_LEVEL: 'debug' },
    };

    expect(service.redactServer(server)).toEqual({
      ...server,
      auth_token: null,
      headers: null,
      env: null,
    });
  });
});
