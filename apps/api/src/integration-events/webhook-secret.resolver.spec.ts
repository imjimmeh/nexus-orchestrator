import { describe, expect, it, vi, afterEach } from 'vitest';
import { WebhookSecretResolver } from './webhook-secret.resolver';

afterEach(() => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
  vi.restoreAllMocks();
});

describe('WebhookSecretResolver.resolveSecret', () => {
  it('returns the GITHUB_WEBHOOK_SECRET env fallback when set', async () => {
    process.env.GITHUB_WEBHOOK_SECRET = 'env-secret';
    const secretCrud = { findByIdRaw: vi.fn() };
    const resolver = new WebhookSecretResolver(secretCrud as never);

    await expect(resolver.resolveSecret(null)).resolves.toBe('env-secret');
    expect(secretCrud.findByIdRaw).not.toHaveBeenCalled();
  });

  it('returns null when neither env nor a scope secret is configured', async () => {
    const secretCrud = { findByIdRaw: vi.fn().mockResolvedValue(null) };
    const resolver = new WebhookSecretResolver(secretCrud as never);

    await expect(resolver.resolveSecret('scope-1')).resolves.toBeNull();
  });
});
