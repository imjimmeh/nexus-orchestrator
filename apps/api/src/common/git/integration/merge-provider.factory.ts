import { BadRequestException, Injectable } from '@nestjs/common';
import { GitHubMergeProvider } from './github-merge.provider';
import { GitLabMergeProvider } from './gitlab-merge.provider';
import { BitbucketMergeProvider } from './bitbucket-merge.provider';
import { parseRepositoryUrl } from './repository-url.parser';
import type { SupportedProvider } from './repository-url.parser.types';
import type { MergeProvider } from './merge-provider.interface';

/**
 * Selects the {@link MergeProvider} adapter for a repository from its URL host
 * (github / gitlab / bitbucket, incl. self-hosted hosts). An explicit override
 * disambiguates hosts that match no known pattern. This is the single
 * resolution point — Phase 3/4 consumers depend only on the returned interface.
 */
@Injectable()
export class MergeProviderFactory {
  constructor(
    private readonly gitHubMergeProvider: GitHubMergeProvider,
    private readonly gitLabMergeProvider: GitLabMergeProvider,
    private readonly bitbucketMergeProvider: BitbucketMergeProvider,
  ) {}

  /**
   * @param repositoryUrl the repository remote URL used to detect the provider.
   * @param providerOverride explicit provider key for hosts that match no known
   *   pattern (e.g. GitHub Enterprise / self-managed instances on custom hosts).
   */
  resolveForRepository(
    repositoryUrl: string,
    providerOverride?: string,
  ): MergeProvider {
    const provider = providerOverride
      ? this.assertSupported(providerOverride)
      : parseRepositoryUrl(repositoryUrl).provider;
    return this.byKey(provider);
  }

  private assertSupported(value: string): SupportedProvider {
    if (value === 'github' || value === 'gitlab' || value === 'bitbucket') {
      return value;
    }
    throw new BadRequestException(
      `Unsupported merge provider override: ${value}`,
    );
  }

  private byKey(provider: SupportedProvider): MergeProvider {
    switch (provider) {
      case 'gitlab':
        return this.gitLabMergeProvider;
      case 'bitbucket':
        return this.bitbucketMergeProvider;
      case 'github':
      default:
        return this.gitHubMergeProvider;
    }
  }
}
