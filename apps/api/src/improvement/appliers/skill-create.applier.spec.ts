import { describe, expect, it, vi } from 'vitest';
import { SkillCreateApplier } from './skill-create.applier';

describe('SkillCreateApplier', () => {
  it('dispatches the create_skill workflow with the proposal id', async () => {
    const engine = { startWorkflow: vi.fn(async () => 'run-1') };
    const applier = new SkillCreateApplier(engine as never);
    const result = await applier.apply({
      id: 'p1',
      kind: 'skill_create',
      payload: {
        target_skill_name: 'merge-doctor',
        patch_markdown: '# body',
        proposal_summary: 'summary',
      },
      provenance: {},
    } as never);
    expect(result.ok).toBe(true);
    expect(engine.startWorkflow).toHaveBeenCalledWith(
      'create_skill',
      expect.objectContaining({
        target_skill_name: 'merge-doctor',
        source_proposal_id: 'p1',
      }),
    );
  });

  it('fails when the workflow could not be started', async () => {
    const engine = { startWorkflow: vi.fn(async () => null) };
    const applier = new SkillCreateApplier(engine as never);
    const result = await applier.apply({
      id: 'p2',
      kind: 'skill_create',
      payload: {
        target_skill_name: 'x',
        patch_markdown: 'b',
        proposal_summary: 's',
      },
      provenance: {},
    } as never);
    expect(result.ok).toBe(false);
  });
});
