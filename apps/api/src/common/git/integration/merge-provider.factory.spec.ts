import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { MergeProviderFactory } from './merge-provider.factory';
import type { GitHubMergeProvider } from './github-merge.provider';
import type { GitLabMergeProvider } from './gitlab-merge.provider';
import type { BitbucketMergeProvider } from './bitbucket-merge.provider';

const github = { providerKey: 'github' } as unknown as GitHubMergeProvider;
const gitlab = { providerKey: 'gitlab' } as unknown as GitLabMergeProvider;
const bitbucket = {
  providerKey: 'bitbucket',
} as unknown as BitbucketMergeProvider;

function factory() {
  return new MergeProviderFactory(github, gitlab, bitbucket);
}

describe('MergeProviderFactory', () => {
  it('returns the github provider for a github https url', () => {
    expect(
      factory().resolveForRepository('https://github.com/acme/widgets.git')
        .providerKey,
    ).toBe('github');
  });

  it('returns the github provider for an ssh url', () => {
    expect(
      factory().resolveForRepository('git@github.com:acme/widgets.git')
        .providerKey,
    ).toBe('github');
  });

  it('returns the gitlab provider for a gitlab url', () => {
    expect(
      factory().resolveForRepository('https://gitlab.com/acme/widgets.git')
        .providerKey,
    ).toBe('gitlab');
  });

  it('returns the bitbucket provider for a bitbucket url', () => {
    expect(
      factory().resolveForRepository('https://bitbucket.org/acme/widgets.git')
        .providerKey,
    ).toBe('bitbucket');
  });

  it('returns the gitlab provider for a self-hosted gitlab host', () => {
    expect(
      factory().resolveForRepository(
        'https://gitlab.internal.acme.dev/acme/widgets.git',
      ).providerKey,
    ).toBe('gitlab');
  });

  it('honours an explicit provider override for an unknown host', () => {
    expect(
      factory().resolveForRepository(
        'https://git.acme.dev/acme/widgets.git',
        'gitlab',
      ).providerKey,
    ).toBe('gitlab');
  });

  it('throws BadRequestException for an unknown host without an override', () => {
    expect(() =>
      factory().resolveForRepository('https://git.acme.dev/acme/widgets.git'),
    ).toThrow(BadRequestException);
  });
});
