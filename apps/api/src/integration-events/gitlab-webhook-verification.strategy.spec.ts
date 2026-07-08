import { describe, it, expect } from 'vitest';
import { GitlabWebhookVerificationStrategy } from './gitlab-webhook-verification.strategy';

const secret = 'gl-shared-token';
const strategy = new GitlabWebhookVerificationStrategy();
const raw = Buffer.from('{}', 'utf-8');

const mergeEvent = {
  object_kind: 'merge_request',
  project: { namespace: 'acme', name: 'widgets' },
  object_attributes: { iid: 7, action: 'merge', merge_commit_sha: 'sha-merge' },
};

describe('GitlabWebhookVerificationStrategy', () => {
  it('has providerKey gitlab', () => {
    expect(strategy.providerKey).toBe('gitlab');
  });

  it('accepts a matching X-Gitlab-Token and rejects a wrong/absent one', () => {
    expect(strategy.verify(raw, { 'x-gitlab-token': secret }, secret)).toBe(
      true,
    );
    expect(strategy.verify(raw, { 'x-gitlab-token': 'wrong' }, secret)).toBe(
      false,
    );
    expect(strategy.verify(raw, {}, secret)).toBe(false);
  });

  it('extracts the merge identity for a merge_request merge action', () => {
    expect(strategy.extractMerge(mergeEvent)).toEqual({
      provider: 'gitlab',
      owner: 'acme',
      repo: 'widgets',
      prNumber: 7,
      mergeCommitSha: 'sha-merge',
    });
  });

  it('returns null for a non-merge MR action (e.g. open)', () => {
    expect(
      strategy.extractMerge({
        ...mergeEvent,
        object_attributes: { ...mergeEvent.object_attributes, action: 'open' },
      }),
    ).toBeNull();
  });
});
