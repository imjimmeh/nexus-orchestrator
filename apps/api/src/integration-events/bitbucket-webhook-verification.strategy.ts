import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { verifyGithubSignature } from './webhook-signature.util';
import type {
  MergeIdentity,
  WebhookHeaders,
  WebhookVerificationStrategy,
} from './webhook-verification-strategy.types';

const PROVIDER_KEY = 'bitbucket';

const BitbucketFulfilledSchema = z.object({
  repository: z.object({
    name: z.string().min(1),
    workspace: z.object({ slug: z.string().min(1) }),
  }),
  pullrequest: z.object({
    id: z.number().int(),
    merge_commit: z.object({ hash: z.string().min(1) }).nullable(),
  }),
});

/**
 * Bitbucket Cloud webhook verification. When a webhook secret is configured,
 * Bitbucket signs the body with HMAC-SHA256 in `X-Hub-Signature` (sha256=...),
 * identical algorithm to GitHub — only the header name differs. Maps the
 * `pullrequest:fulfilled` event to the neutral merge identity.
 */
@Injectable()
export class BitbucketWebhookVerificationStrategy implements WebhookVerificationStrategy {
  readonly providerKey = PROVIDER_KEY;

  verify(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean {
    return verifyGithubSignature(rawBody, headers['x-hub-signature'], secret);
  }

  extractMerge(parsedBody: unknown): MergeIdentity | null {
    const parsed = BitbucketFulfilledSchema.safeParse(parsedBody);
    if (!parsed.success) {
      return null;
    }
    const { repository, pullrequest } = parsed.data;
    if (!pullrequest.merge_commit) {
      return null;
    }
    return {
      provider: PROVIDER_KEY,
      owner: repository.workspace.slug,
      repo: repository.name,
      prNumber: pullrequest.id,
      mergeCommitSha: pullrequest.merge_commit.hash,
    };
  }
}
