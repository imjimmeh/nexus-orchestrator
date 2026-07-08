import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestTracking } from './pull-request-tracking.entity';
import { PullRequestTrackingRepository } from './pull-request-tracking.repository';

function makeRepoMock() {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    create: vi.fn(
      (v: Partial<PullRequestTracking>) => v as PullRequestTracking,
    ),
    save: vi.fn((v: PullRequestTracking) =>
      Promise.resolve({ ...v, id: v.id ?? 'row-1' }),
    ),
  };
}

const input = {
  provider: 'github',
  owner: 'acme',
  repo: 'widgets',
  prNumber: 42,
  scopeId: 'scope-1',
  contextId: 'context-1',
  workflowRunId: '11111111-1111-1111-1111-111111111111',
  headBranch: 'feature/x',
  baseBranch: 'main',
  prUrl: 'https://github.com/acme/widgets/pull/42',
  githubSecretId: 'secret-1',
  repositoryUrl: 'https://github.com/acme/widgets.git',
  autoMerge: false,
  mergeMethod: 'merge' as const,
};

describe('PullRequestTrackingRepository.recordOpenedPullRequest', () => {
  let typeormRepo: ReturnType<typeof makeRepoMock>;
  let repo: PullRequestTrackingRepository;

  beforeEach(() => {
    typeormRepo = makeRepoMock();
    repo = new PullRequestTrackingRepository(typeormRepo as never);
  });

  it('inserts a new open row when none exists for the provider identity', async () => {
    typeormRepo.findOne.mockResolvedValue(null);

    const row = await repo.recordOpenedPullRequest(input);

    expect(typeormRepo.findOne).toHaveBeenCalledWith({
      where: {
        provider: 'github',
        owner: 'acme',
        repo: 'widgets',
        pr_number: 42,
      },
    });
    expect(typeormRepo.save).toHaveBeenCalledTimes(1);
    expect(row.state).toBe('open');
    expect(row.pr_url).toBe(input.prUrl);
    expect(row.github_secret_id).toBe('secret-1');
    expect(row.repository_url).toBe('https://github.com/acme/widgets.git');
  });

  it('updates the existing row instead of duplicating on re-run', async () => {
    typeormRepo.findOne.mockResolvedValue({
      id: 'existing',
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      pr_number: 42,
      state: 'open',
      pr_url: 'https://github.com/acme/widgets/pull/42',
      head_branch: 'feature/x',
      base_branch: 'main',
      scope_id: 'scope-1',
      context_id: 'context-1',
      workflow_run_id: input.workflowRunId,
      github_secret_id: 'old-secret',
      repository_url: 'https://github.com/acme/widgets.git',
      merge_commit_sha: null,
    });

    const row = await repo.recordOpenedPullRequest({
      ...input,
      githubSecretId: 'rotated-secret',
      prUrl: 'https://github.com/acme/widgets/pull/42?updated',
    });

    expect(typeormRepo.create).not.toHaveBeenCalled();
    expect(typeormRepo.save).toHaveBeenCalledTimes(1);
    expect(row.id).toBe('existing');
    expect(row.pr_url).toBe('https://github.com/acme/widgets/pull/42?updated');
    expect(row.github_secret_id).toBe('rotated-secret');
    expect(row.repository_url).toBe('https://github.com/acme/widgets.git');
  });

  it('persists auto_merge and merge_method on a new row', async () => {
    typeormRepo.findOne.mockResolvedValue(null);

    const row = await repo.recordOpenedPullRequest({
      ...input,
      autoMerge: true,
      mergeMethod: 'squash',
    });

    expect(row.auto_merge).toBe(true);
    expect(row.merge_method).toBe('squash');
  });

  it('updates auto_merge and merge_method on re-run', async () => {
    typeormRepo.findOne.mockResolvedValue({
      id: 'existing',
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      pr_number: 42,
      state: 'open',
      pr_url: 'u',
      head_branch: 'feature/x',
      base_branch: 'main',
      scope_id: 's',
      context_id: 'c',
      workflow_run_id: input.workflowRunId,
      github_secret_id: 'old-secret',
      repository_url: 'https://github.com/acme/widgets.git',
      merge_commit_sha: null,
      auto_merge: false,
      merge_method: 'merge',
    });

    const row = await repo.recordOpenedPullRequest({
      ...input,
      autoMerge: true,
      mergeMethod: 'rebase',
    });

    expect(row.auto_merge).toBe(true);
    expect(row.merge_method).toBe('rebase');
  });
});

describe('PullRequestTrackingRepository.findOpen', () => {
  it('loads only rows in the open state', async () => {
    const typeormRepo = makeRepoMock();
    typeormRepo.find = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const repo = new PullRequestTrackingRepository(typeormRepo as never);

    const rows = await repo.findOpen();

    expect(typeormRepo.find).toHaveBeenCalledWith({ where: { state: 'open' } });
    expect(rows).toHaveLength(2);
  });
});

describe('PullRequestTrackingRepository.markMerged', () => {
  it('flips an open row to merged atomically via a conditional update (affected=1)', async () => {
    const typeormRepo = makeRepoMock();
    // The conditional UPDATE ... WHERE id AND state='open' wins the race.
    typeormRepo.update = vi.fn().mockResolvedValue({ affected: 1 });
    typeormRepo.findOneOrFail = vi.fn().mockResolvedValue({
      id: 'row-1',
      state: 'merged',
      merge_commit_sha: 'sha-merge',
    });
    const repo = new PullRequestTrackingRepository(typeormRepo as never);

    const result = await repo.markMerged('row-1', 'sha-merge');

    expect(typeormRepo.update).toHaveBeenCalledWith(
      { id: 'row-1', state: 'open' },
      { state: 'merged', merge_commit_sha: 'sha-merge' },
    );
    expect(result.alreadyMerged).toBe(false);
    expect(result.row.state).toBe('merged');
    expect(result.row.merge_commit_sha).toBe('sha-merge');
    // Read-modify-write must not be used: no findOne/save round trip.
    expect(typeormRepo.save).not.toHaveBeenCalled();
  });

  it('is a no-op when another caller already merged the row (affected=0)', async () => {
    const typeormRepo = makeRepoMock();
    // The conditional UPDATE matched no open row: the race was lost.
    typeormRepo.update = vi.fn().mockResolvedValue({ affected: 0 });
    typeormRepo.findOneOrFail = vi.fn().mockResolvedValue({
      id: 'row-1',
      state: 'merged',
      merge_commit_sha: 'sha-merge',
    });
    const repo = new PullRequestTrackingRepository(typeormRepo as never);

    const result = await repo.markMerged('row-1', 'sha-merge');

    expect(result.alreadyMerged).toBe(true);
    expect(result.row.state).toBe('merged');
    expect(typeormRepo.save).not.toHaveBeenCalled();
  });
});
