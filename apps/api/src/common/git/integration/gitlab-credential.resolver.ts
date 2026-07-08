import { BadRequestException, Injectable } from '@nestjs/common';
import { SecretReferenceResolver } from '../../../security/secret-reference-resolver.service';

const SERVER_NAME = 'gitlab-merge-provider';

/**
 * Resolves a GitLab API token from a project's `gitlab_secret_id` via the
 * encrypted secret store. The token is never logged, never returned in an error
 * message, and never embedded in a key name.
 */
@Injectable()
export class GitLabCredentialResolver {
  constructor(
    private readonly secretReferenceResolver: SecretReferenceResolver,
  ) {}

  async resolveToken(gitlabSecretId: string): Promise<string> {
    if (!gitlabSecretId) {
      throw new BadRequestException(
        'gitlab_secret_id is required to authenticate with GitLab',
      );
    }
    const token = await this.secretReferenceResolver.resolveString({
      secretId: gitlabSecretId,
      purpose: 'auth',
      serverName: SERVER_NAME,
    });
    if (!token) {
      throw new BadRequestException(
        'gitlab_secret_id did not resolve to a usable token',
      );
    }
    return token;
  }
}
