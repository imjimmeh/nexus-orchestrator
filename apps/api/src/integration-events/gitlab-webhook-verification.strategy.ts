import { timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  MergeIdentity,
  WebhookHeaders,
  WebhookVerificationStrategy,
} from './webhook-verification-strategy.types';

const PROVIDER_KEY = 'gitlab';

const GitlabMergeEventSchema = z.object({
  object_kind: z.string(),
  project: z.object({ namespace: z.string().min(1), name: z.string().min(1) }),
  object_attributes: z.object({
    iid: z.number().int(),
    action: z.string(),
    merge_commit_sha: z.string().nullable().optional(),
  }),
});

/**
 * GitLab webhook verification. GitLab authenticates webhooks with a shared
 * secret token in the `X-Gitlab-Token` header (no HMAC over the body). Maps a
 * `merge_request` event with a `merge` action to the neutral merge identity.
 * The secret is never logged or echoed.
 */
@Injectable()
export class GitlabWebhookVerificationStrategy implements WebhookVerificationStrategy {
  readonly providerKey = PROVIDER_KEY;

  verify(_rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean {
    const provided = headers['x-gitlab-token'];
    if (!provided) {
      return false;
    }
    const a = Buffer.from(provided, 'utf-8');
    const b = Buffer.from(secret, 'utf-8');
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  extractMerge(parsedBody: unknown): MergeIdentity | null {
    const parsed = GitlabMergeEventSchema.safeParse(parsedBody);
    if (!parsed.success) {
      return null;
    }
    const event = parsed.data;
    if (
      event.object_kind !== 'merge_request' ||
      event.object_attributes.action !== 'merge' ||
      typeof event.object_attributes.merge_commit_sha !== 'string'
    ) {
      return null;
    }
    return {
      provider: PROVIDER_KEY,
      owner: event.project.namespace,
      repo: event.project.name,
      prNumber: event.object_attributes.iid,
      mergeCommitSha: event.object_attributes.merge_commit_sha,
    };
  }
}
