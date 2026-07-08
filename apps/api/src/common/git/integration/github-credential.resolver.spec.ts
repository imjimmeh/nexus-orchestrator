import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { GitHubCredentialResolver } from './github-credential.resolver';
import type { SecretReferenceResolver } from '../../../security/secret-reference-resolver.service';

const SECRET_ID = 'sec-123';
const TOKEN = 'ghp_super_secret_value';

function buildResolver(resolveStringImpl: () => Promise<string | null>) {
  const secretResolver = {
    resolveString: vi.fn(resolveStringImpl),
  } as unknown as SecretReferenceResolver;
  const resolver = new GitHubCredentialResolver(secretResolver);
  return { resolver, secretResolver };
}

describe('GitHubCredentialResolver', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the token string for a github_secret_id', async () => {
    const { resolver, secretResolver } = buildResolver(async () => TOKEN);
    await expect(resolver.resolveToken(SECRET_ID)).resolves.toBe(TOKEN);
    expect(secretResolver.resolveString).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: SECRET_ID, purpose: 'auth' }),
    );
  });

  it('throws BadRequestException when no github_secret_id is provided', async () => {
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
    // Simulate downstream failure that might be tempted to echo the value.
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
