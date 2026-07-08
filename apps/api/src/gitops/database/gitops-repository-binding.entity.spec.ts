import { describe, expect, it } from 'vitest';
import { GitOpsRepositoryBinding } from './entities/gitops-repository-binding.entity';
import { GitOpsReconcileRun } from './entities/gitops-reconcile-run.entity';
import { GitOpsPendingChange } from './entities/gitops-pending-change.entity';

describe('GitOps persistence entities', () => {
  it('defines repository binding table metadata', () => {
    expect(GitOpsRepositoryBinding.name).toBe('GitOpsRepositoryBinding');
    expect(new GitOpsRepositoryBinding()).toMatchObject({ enabled: true });
  });

  it('defines run and pending-change entities', () => {
    expect(GitOpsReconcileRun.name).toBe('GitOpsReconcileRun');
    expect(GitOpsPendingChange.name).toBe('GitOpsPendingChange');
  });
});
