import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { BitbucketWebhookVerificationStrategy } from './bitbucket-webhook-verification.strategy';

const secret = 'bb-secret';
const strategy = new BitbucketWebhookVerificationStrategy();

const fulfilled = {
  repository: { name: 'widgets', workspace: { slug: 'acme' } },
  pullrequest: { id: 7, merge_commit: { hash: 'sha-merge' } },
};

function raw(body: unknown) {
  return Buffer.from(JSON.stringify(body), 'utf-8');
}
function sig(buf: Buffer, key = secret) {
  return `sha256=${createHmac('sha256', key).update(buf).digest('hex')}`;
}

describe('BitbucketWebhookVerificationStrategy', () => {
  it('has providerKey bitbucket', () => {
    expect(strategy.providerKey).toBe('bitbucket');
  });

  it('verifies a valid X-Hub-Signature and rejects tampered/absent', () => {
    const body = raw(fulfilled);
    expect(
      strategy.verify(body, { 'x-hub-signature': sig(body) }, secret),
    ).toBe(true);
    expect(
      strategy.verify(body, { 'x-hub-signature': sig(body, 'other') }, secret),
    ).toBe(false);
    expect(strategy.verify(body, {}, secret)).toBe(false);
  });

  it('extracts the merge identity for a pullrequest:fulfilled event', () => {
    expect(strategy.extractMerge(fulfilled)).toEqual({
      provider: 'bitbucket',
      owner: 'acme',
      repo: 'widgets',
      prNumber: 7,
      mergeCommitSha: 'sha-merge',
    });
  });

  it('returns null when there is no merge commit', () => {
    expect(
      strategy.extractMerge({
        ...fulfilled,
        pullrequest: { id: 7, merge_commit: null },
      }),
    ).toBeNull();
  });
});
