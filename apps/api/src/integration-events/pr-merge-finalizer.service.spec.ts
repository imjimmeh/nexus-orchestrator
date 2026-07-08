import { describe, expect, it, vi } from 'vitest';
import { PrMergeFinalizerService } from './pr-merge-finalizer.service';

function build() {
  const trackingRepo = {
    findByProviderIdentity: vi.fn(),
    markMerged: vi.fn(),
  };
  const publisher = { publishPrMerged: vi.fn().mockResolvedValue('1-0') };
  const service = new PrMergeFinalizerService(
    trackingRepo as never,
    publisher as never,
  );
  return { service, trackingRepo, publisher };
}

const openRow = {
  id: 'row-1',
  provider: 'github',
  owner: 'acme',
  repo: 'widgets',
  pr_number: 42,
  scope_id: 'scope-1',
  context_id: 'context-1',
  pr_url: 'https://github.com/acme/widgets/pull/42',
  state: 'open',
  merge_commit_sha: null,
};

describe('PrMergeFinalizerService.finalizeMergedByIdentity', () => {
  it('marks the row merged and emits the neutral pr_merged event once', async () => {
    const { service, trackingRepo, publisher } = build();
    trackingRepo.findByProviderIdentity.mockResolvedValue(openRow);
    trackingRepo.markMerged.mockResolvedValue({
      alreadyMerged: false,
      row: { ...openRow, state: 'merged', merge_commit_sha: 'sha-merge' },
    });

    const result = await service.finalizeMergedByIdentity({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      prNumber: 42,
      mergeCommitSha: 'sha-merge',
    });

    expect(result.emitted).toBe(true);
    expect(trackingRepo.markMerged).toHaveBeenCalledWith('row-1', 'sha-merge');
    expect(publisher.publishPrMerged).toHaveBeenCalledWith({
      scopeId: 'scope-1',
      contextId: 'context-1',
      prUrl: 'https://github.com/acme/widgets/pull/42',
      mergeCommitSha: 'sha-merge',
    });
  });

  it('is a no-op (no emit) when the row is already merged', async () => {
    const { service, trackingRepo, publisher } = build();
    trackingRepo.findByProviderIdentity.mockResolvedValue({
      ...openRow,
      state: 'merged',
    });
    trackingRepo.markMerged.mockResolvedValue({
      alreadyMerged: true,
      row: { ...openRow, state: 'merged', merge_commit_sha: 'sha-merge' },
    });

    const result = await service.finalizeMergedByIdentity({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      prNumber: 42,
      mergeCommitSha: 'sha-merge',
    });

    expect(result.emitted).toBe(false);
    expect(publisher.publishPrMerged).not.toHaveBeenCalled();
  });

  it('is a no-op when no tracking row exists for the identity', async () => {
    const { service, trackingRepo, publisher } = build();
    trackingRepo.findByProviderIdentity.mockResolvedValue(null);

    const result = await service.finalizeMergedByIdentity({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      prNumber: 99,
      mergeCommitSha: 'sha-merge',
    });

    expect(result.emitted).toBe(false);
    expect(trackingRepo.markMerged).not.toHaveBeenCalled();
    expect(publisher.publishPrMerged).not.toHaveBeenCalled();
  });
});

describe('PrMergeFinalizerService convergence (webhook + poll)', () => {
  it('emits exactly once when both paths process the same merge', async () => {
    const { service, trackingRepo, publisher } = build();
    // First call (webhook): open -> merged, emits.
    trackingRepo.findByProviderIdentity.mockResolvedValueOnce(openRow);
    trackingRepo.markMerged.mockResolvedValueOnce({
      alreadyMerged: false,
      row: { ...openRow, state: 'merged', merge_commit_sha: 'sha-merge' },
    });
    // Second call (poll, same row already merged): no emit.
    trackingRepo.markMerged.mockResolvedValueOnce({
      alreadyMerged: true,
      row: { ...openRow, state: 'merged', merge_commit_sha: 'sha-merge' },
    });

    const first = await service.finalizeMergedByIdentity({
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      prNumber: 42,
      mergeCommitSha: 'sha-merge',
    });
    const second = await service.finalizeMergedRow(
      { ...openRow, state: 'merged' } as never,
      'sha-merge',
    );

    expect(first.emitted).toBe(true);
    expect(second.emitted).toBe(false);
    expect(publisher.publishPrMerged).toHaveBeenCalledTimes(1);
  });
});
