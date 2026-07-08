import { BadRequestException, Injectable } from '@nestjs/common';
import { SecretReferenceResolver } from '../../../security/secret-reference-resolver.service';

const SERVER_NAME = 'bitbucket-merge-provider';

/**
 * Resolves a Bitbucket API token (app password / access token) from a project's
 * `bitbucket_secret_id` via the encrypted secret store. Never logged, never
 * returned in an error message, never embedded in a key name.
 */
@Injectable()
export class BitbucketCredentialResolver {
  constructor(
    private readonly secretReferenceResolver: SecretReferenceResolver,
  ) {}

  async resolveToken(bitbucketSecretId: string): Promise<string> {
    if (!bitbucketSecretId) {
      throw new BadRequestException(
        'bitbucket_secret_id is required to authenticate with Bitbucket',
      );
    }
    const token = await this.secretReferenceResolver.resolveString({
      secretId: bitbucketSecretId,
      purpose: 'auth',
      serverName: SERVER_NAME,
    });
    if (!token) {
      throw new BadRequestException(
        'bitbucket_secret_id did not resolve to a usable token',
      );
    }
    return token;
  }
}
