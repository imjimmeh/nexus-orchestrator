import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { GithubWebhookVerificationStrategy } from './github-webhook-verification.strategy';

const secret = 'wh-secret';
const strategy = new GithubWebhookVerificationStrategy();

const merged = {
  action: 'closed',
  repository: { name: 'widgets', owner: { login: 'acme' } },
  pull_request: {
    number: 42,
    merged: true,
    merge_commit_sha: 'sha-merge',
    html_url: 'u',
  },
};

function raw(body: unknown) {
  return Buffer.from(JSON.stringify(body), 'utf-8');
}
function sig(buf: Buffer, key = secret) {
  return `sha256=${createHmac('sha256', key).update(buf).digest('hex')}`;
}

describe('GithubWebhookVerificationStrategy', () => {
  it('has providerKey github', () => {
    expect(strategy.providerKey).toBe('github');
  });

  it('verifies a valid signature and rejects a tampered/absent one', () => {
    const body = raw(merged);
    expect(
      strategy.verify(body, { 'x-hub-signature-256': sig(body) }, secret),
    ).toBe(true);
    expect(
      strategy.verify(
        body,
        { 'x-hub-signature-256': sig(body, 'other') },
        secret,
      ),
    ).toBe(false);
    expect(strategy.verify(body, {}, secret)).toBe(false);
  });

  it('extracts the merge identity for a closed+merged event', () => {
    expect(strategy.extractMerge(merged)).toEqual({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      prNumber: 42,
      mergeCommitSha: 'sha-merge',
    });
  });

  it('returns null for a closed-unmerged event', () => {
    expect(
      strategy.extractMerge({
        ...merged,
        pull_request: { ...merged.pull_request, merged: false },
      }),
    ).toBeNull();
  });
});
