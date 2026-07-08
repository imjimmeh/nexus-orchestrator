import { Injectable } from '@nestjs/common';
import { GithubPrWebhookPayloadSchema } from './github-pr-webhook.types';
import { verifyGithubSignature } from './webhook-signature.util';
import type {
  MergeIdentity,
  WebhookHeaders,
  WebhookVerificationStrategy,
} from './webhook-verification-strategy.types';

const PROVIDER_KEY = 'github';

@Injectable()
export class GithubWebhookVerificationStrategy implements WebhookVerificationStrategy {
  readonly providerKey = PROVIDER_KEY;

  verify(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean {
    return verifyGithubSignature(
      rawBody,
      headers['x-hub-signature-256'],
      secret,
    );
  }

  extractMerge(parsedBody: unknown): MergeIdentity | null {
    const parsed = GithubPrWebhookPayloadSchema.safeParse(parsedBody);
    if (!parsed.success) {
      return null;
    }
    const payload = parsed.data;
    if (
      payload.action !== 'closed' ||
      payload.pull_request.merged !== true ||
      typeof payload.pull_request.merge_commit_sha !== 'string'
    ) {
      return null;
    }
    return {
      provider: PROVIDER_KEY,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      prNumber: payload.pull_request.number,
      mergeCommitSha: payload.pull_request.merge_commit_sha,
    };
  }
}
