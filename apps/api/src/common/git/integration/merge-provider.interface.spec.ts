import { describe, expect, it } from 'vitest';
import {
  MERGE_PROVIDER,
  type IntegrationStrategy,
  type MergeMethod,
  type MergeProvider,
  type PullRequestRef,
} from './merge-provider.interface';

describe('merge-provider contract', () => {
  it('exposes a uniquely-described injection token', () => {
    expect(MERGE_PROVIDER.toString()).toBe('Symbol(MERGE_PROVIDER)');
  });

  it('accepts a conforming implementation (structural type check)', async () => {
    const ref: PullRequestRef = {
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      number: 7,
      url: 'https://github.com/acme/widgets/pull/7',
    };

    const impl: MergeProvider = {
      providerKey: 'github',
      openOrUpdatePullRequest: async () => ref,
      getPullRequestStatus: async (r) => ({
        ref: r,
        state: 'open',
        checks: 'pending',
        reviewDecision: 'none',
        mergeCommitSha: null,
        mergeable: null,
      }),
      mergePullRequest: async () => ({ mergeCommitSha: 'abc123' }),
    };

    const strategies: IntegrationStrategy[] = ['direct-push', 'pull-request'];
    const methods: MergeMethod[] = ['merge', 'squash', 'rebase'];

    expect(impl.providerKey).toBe('github');
    expect(await impl.getPullRequestStatus(ref)).toMatchObject({
      state: 'open',
    });
    expect(strategies).toHaveLength(2);
    expect(methods).toHaveLength(3);
  });
});
