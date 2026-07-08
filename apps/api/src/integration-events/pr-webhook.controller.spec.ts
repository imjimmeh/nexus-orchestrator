import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrWebhookController } from './pr-webhook.controller';
import { GithubWebhookVerificationStrategy } from './github-webhook-verification.strategy';
import { GitlabWebhookVerificationStrategy } from './gitlab-webhook-verification.strategy';
import { WebhookVerificationStrategyRegistry } from './webhook-verification-strategy.registry';

const secret = 'wh-secret';

const githubMerged = {
  action: 'closed',
  repository: { name: 'widgets', owner: { login: 'acme' } },
  pull_request: {
    number: 42,
    merged: true,
    merge_commit_sha: 'sha-merge',
    html_url: 'u',
  },
};
const gitlabMerged = {
  object_kind: 'merge_request',
  project: { namespace: 'acme', name: 'widgets' },
  object_attributes: { iid: 7, action: 'merge', merge_commit_sha: 'sha-merge' },
};

function makeReq(raw: Buffer) {
  return { rawBody: raw } as never;
}
function ghSig(raw: Buffer, key = secret) {
  return `sha256=${createHmac('sha256', key).update(raw).digest('hex')}`;
}

describe('PrWebhookController (multi-provider)', () => {
  let finalizer: { finalizeMergedByIdentity: ReturnType<typeof vi.fn> };
  let secretResolver: { resolveSecret: ReturnType<typeof vi.fn> };
  let controller: PrWebhookController;

  beforeEach(() => {
    finalizer = {
      finalizeMergedByIdentity: vi.fn().mockResolvedValue({ emitted: true }),
    };
    secretResolver = { resolveSecret: vi.fn().mockResolvedValue(secret) };
    const registry = new WebhookVerificationStrategyRegistry([
      new GithubWebhookVerificationStrategy(),
      new GitlabWebhookVerificationStrategy(),
    ]);
    controller = new PrWebhookController(
      finalizer as never,
      secretResolver as never,
      registry,
    );
  });

  it('finalizes a github closed+merged event with a valid signature', async () => {
    const raw = Buffer.from(JSON.stringify(githubMerged), 'utf-8');
    const result = await controller.handle(
      'github',
      makeReq(raw),
      githubMerged,
      {
        'x-hub-signature-256': ghSig(raw),
      },
    );
    expect(finalizer.finalizeMergedByIdentity).toHaveBeenCalledWith({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      prNumber: 42,
      mergeCommitSha: 'sha-merge',
    });
    expect(result).toEqual({ success: true, processed: true });
  });

  it('finalizes a gitlab merge_request merge with a valid X-Gitlab-Token', async () => {
    const raw = Buffer.from(JSON.stringify(gitlabMerged), 'utf-8');
    const result = await controller.handle(
      'gitlab',
      makeReq(raw),
      gitlabMerged,
      {
        'x-gitlab-token': secret,
      },
    );
    expect(finalizer.finalizeMergedByIdentity).toHaveBeenCalledWith({
      provider: 'gitlab',
      owner: 'acme',
      repo: 'widgets',
      prNumber: 7,
      mergeCommitSha: 'sha-merge',
    });
    expect(result).toEqual({ success: true, processed: true });
  });

  it('rejects a tampered/absent gitlab token with 401', async () => {
    const raw = Buffer.from(JSON.stringify(gitlabMerged), 'utf-8');
    await expect(
      controller.handle('gitlab', makeReq(raw), gitlabMerged as never, {
        'x-gitlab-token': 'wrong',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(finalizer.finalizeMergedByIdentity).not.toHaveBeenCalled();
  });

  it('rejects an absent github signature with 401', async () => {
    const raw = Buffer.from(JSON.stringify(githubMerged), 'utf-8');
    await expect(
      controller.handle('github', makeReq(raw), githubMerged as never, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(finalizer.finalizeMergedByIdentity).not.toHaveBeenCalled();
  });

  it('returns 401 when no secret is configured', async () => {
    secretResolver.resolveSecret.mockResolvedValue(null);
    const raw = Buffer.from(JSON.stringify(githubMerged), 'utf-8');
    await expect(
      controller.handle('github', makeReq(raw), githubMerged as never, {
        'x-hub-signature-256': ghSig(raw),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a missing raw body with 401', async () => {
    await expect(
      controller.handle('github', {}, githubMerged as never, {
        'x-hub-signature-256': 'sha256=deadbeef',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ignores a non-merge event (processed:false, no finalize)', async () => {
    const opened = {
      ...githubMerged,
      pull_request: { ...githubMerged.pull_request, merged: false },
    };
    const raw = Buffer.from(JSON.stringify(opened), 'utf-8');
    const result = await controller.handle('github', makeReq(raw), opened, {
      'x-hub-signature-256': ghSig(raw),
    });
    expect(finalizer.finalizeMergedByIdentity).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, processed: false });
  });
});
