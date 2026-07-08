import { BadRequestException, Injectable } from '@nestjs/common';
import { SecretReferenceResolver } from '../../../security/secret-reference-resolver.service';

const SERVER_NAME = 'github-merge-provider';

/**
 * Resolves a GitHub API token from a project's `github_secret_id` via the
 * encrypted secret store. The token is never logged, never returned in an
 * error message, and never embedded in a key name.
 */
@Injectable()
export class GitHubCredentialResolver {
  constructor(
    private readonly secretReferenceResolver: SecretReferenceResolver,
  ) {}

  async resolveToken(githubSecretId: string): Promise<string> {
    if (!githubSecretId) {
      throw new BadRequestException(
        'github_secret_id is required to authenticate with GitHub',
      );
    }

    const token = await this.secretReferenceResolver.resolveString({
      secretId: githubSecretId,
      purpose: 'auth',
      serverName: SERVER_NAME,
    });

    if (!token) {
      throw new BadRequestException(
        'github_secret_id did not resolve to a usable token',
      );
    }

    return token;
  }
}
