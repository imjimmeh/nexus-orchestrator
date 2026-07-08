import { describe, expect, it, vi } from 'vitest';
import { WorkflowSkillBindingService } from './workflow-skill-binding.service';

function makeRepo() {
  const rows: any[] = [];
  return {
    rows,
    findExisting: vi.fn(
      async (k: any) =>
        rows.find(
          (r) =>
            r.workflow_name === k.workflowName &&
            (r.step_id ?? null) === (k.stepId ?? null) &&
            r.skill_name === k.skillName,
        ) ?? null,
    ),
    insert: vi.fn(async (v: any) => {
      const row = { id: `b${rows.length + 1}`, ...v };
      rows.push(row);
      return row;
    }),
    deleteExisting: vi.fn(async (k: any) => {
      const index = rows.findIndex(
        (r) =>
          r.workflow_name === k.workflowName &&
          (r.step_id ?? null) === (k.stepId ?? null) &&
          r.skill_name === k.skillName,
      );
      if (index >= 0) rows.splice(index, 1);
    }),
    listForWorkflow: vi.fn(async (name: string) =>
      rows.filter((r) => r.workflow_name === name),
    ),
  };
}

describe('WorkflowSkillBindingService.addBinding', () => {
  it('is idempotent on the unique key', async () => {
    const repo = makeRepo();
    const svc = new WorkflowSkillBindingService(repo as any);
    await svc.addBinding({ workflowName: 'w', stepId: 's', skillName: 'sk' });
    await svc.addBinding({ workflowName: 'w', stepId: 's', skillName: 'sk' });
    expect(repo.insert).toHaveBeenCalledOnce();
  });

  it('treats null step_id (whole-workflow) as distinct from a step binding', async () => {
    const repo = makeRepo();
    const svc = new WorkflowSkillBindingService(repo as any);
    await svc.addBinding({ workflowName: 'w', stepId: null, skillName: 'sk' });
    await svc.addBinding({ workflowName: 'w', stepId: 's', skillName: 'sk' });
    expect(repo.insert).toHaveBeenCalledTimes(2);
  });

  it('normalizes an empty-string stepId to null (workflow-scoped), deduping with an existing null-step binding', async () => {
    const repo = makeRepo();
    const svc = new WorkflowSkillBindingService(repo as any);
    await svc.addBinding({ workflowName: 'w', stepId: null, skillName: 'sk' });
    await svc.addBinding({ workflowName: 'w', stepId: '', skillName: 'sk' });
    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.findExisting).toHaveBeenLastCalledWith(
      expect.objectContaining({ stepId: null }),
    );
  });

  it('normalizes a whitespace-only stepId to null (workflow-scoped)', async () => {
    const repo = makeRepo();
    const svc = new WorkflowSkillBindingService(repo as any);
    await svc.addBinding({ workflowName: 'w', stepId: null, skillName: 'sk' });
    await svc.addBinding({ workflowName: 'w', stepId: '   ', skillName: 'sk' });
    expect(repo.insert).toHaveBeenCalledTimes(1);
  });
});

describe('WorkflowSkillBindingService.removeBinding', () => {
  it('deletes the row matching the exact key', async () => {
    const repo = makeRepo();
    const svc = new WorkflowSkillBindingService(repo as any);
    await svc.addBinding({ workflowName: 'w', stepId: 's', skillName: 'sk' });
    await svc.removeBinding({
      workflowName: 'w',
      stepId: 's',
      skillName: 'sk',
    });
    expect(repo.deleteExisting).toHaveBeenCalledOnce();
    expect(repo.rows).toHaveLength(0);
  });

  it('normalizes an empty/whitespace stepId to null so it deletes the workflow-scoped row', async () => {
    const repo = makeRepo();
    const svc = new WorkflowSkillBindingService(repo as any);
    await svc.addBinding({ workflowName: 'w', stepId: null, skillName: 'sk' });

    await svc.removeBinding({ workflowName: 'w', stepId: '', skillName: 'sk' });
    expect(repo.deleteExisting).toHaveBeenLastCalledWith(
      expect.objectContaining({ stepId: null }),
    );
    expect(repo.rows).toHaveLength(0);

    // Whitespace-only collapses the same way (no row left to remove, no throw).
    await svc.removeBinding({
      workflowName: 'w',
      stepId: '   ',
      skillName: 'sk',
    });
    expect(repo.deleteExisting).toHaveBeenLastCalledWith(
      expect.objectContaining({ stepId: null }),
    );
  });
});

describe('WorkflowSkillBindingService.listForWorkflow', () => {
  it('returns only bindings for the requested workflow', async () => {
    const repo = makeRepo();
    const svc = new WorkflowSkillBindingService(repo as any);
    await svc.addBinding({ workflowName: 'w1', stepId: null, skillName: 'sk' });
    await svc.addBinding({ workflowName: 'w2', stepId: null, skillName: 'sk' });
    const result = await svc.listForWorkflow('w1');
    expect(result).toHaveLength(1);
    expect(result[0].workflow_name).toBe('w1');
  });
});
