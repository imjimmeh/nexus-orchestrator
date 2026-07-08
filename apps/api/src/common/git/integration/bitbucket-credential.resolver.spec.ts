import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { BitbucketCredentialResolver } from './bitbucket-credential.resolver';
import type { SecretReferenceResolver } from '../../../security/secret-reference-resolver.service';

const SECRET_ID = 'sec-bb-1';
const TOKEN = 'bbtoken-super-secret';

function buildResolver(impl: () => Promise<string | null>) {
  const secretResolver = {
    resolveString: vi.fn(impl),
  } as unknown as SecretReferenceResolver;
  return {
    resolver: new BitbucketCredentialResolver(secretResolver),
    secretResolver,
  };
}

describe('BitbucketCredentialResolver', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the token for a bitbucket_secret_id', async () => {
    const { resolver, secretResolver } = buildResolver(async () => TOKEN);
    await expect(resolver.resolveToken(SECRET_ID)).resolves.toBe(TOKEN);
    expect(secretResolver.resolveString).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: SECRET_ID, purpose: 'auth' }),
    );
  });

  it('throws BadRequestException when the secret id is empty', async () => {
    const { resolver } = buildResolver(async () => null);
    await expect(resolver.resolveToken('')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws BadRequestException when the secret resolves empty', async () => {
    const { resolver } = buildResolver(async () => null);
    await expect(resolver.resolveToken(SECRET_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('never includes the token value in a thrown error message', async () => {
    const { resolver } = buildResolver(async () => {
      throw new Error('decrypt failed');
    });
    try {
      await resolver.resolveToken(SECRET_ID);
      throw new Error('expected resolveToken to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });
});
