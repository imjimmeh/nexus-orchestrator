import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { WebhookVerificationStrategyRegistry } from './webhook-verification-strategy.registry';
import type { WebhookVerificationStrategy } from './webhook-verification-strategy.types';

const stub = (key: string): WebhookVerificationStrategy => ({
  providerKey: key,
  verify: () => true,
  extractMerge: () => null,
});

describe('WebhookVerificationStrategyRegistry', () => {
  it('returns the strategy whose providerKey matches', () => {
    const registry = new WebhookVerificationStrategyRegistry([
      stub('github'),
      stub('gitlab'),
      stub('bitbucket'),
    ]);
    expect(registry.forProvider('gitlab').providerKey).toBe('gitlab');
  });

  it('throws BadRequestException for an unknown provider', () => {
    const registry = new WebhookVerificationStrategyRegistry([stub('github')]);
    expect(() => registry.forProvider('svn')).toThrow(BadRequestException);
  });
});
