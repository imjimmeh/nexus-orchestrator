import { describe, expect, it, vi } from 'vitest';
import { AddLearningCandidateDecisionColumns20260711000000 } from './20260711000000-add-learning-candidate-decision-columns';

describe('AddLearningCandidateDecisionColumns migration', () => {
  it('adds the reject and archive audit columns', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddLearningCandidateDecisionColumns20260711000000().up({
      query,
    } as never);

    const sql = query.mock.calls.map((call) => call[0] as string).join('\n');
    expect(sql).toContain('rejected_by');
    expect(sql).toContain('rejected_at');
    expect(sql).toContain('rejection_reason');
    expect(sql).toContain('archived_by');
    expect(sql).toContain('archived_at');
    expect(sql).toContain('archive_reason');
  });

  it('drops the reject and archive audit columns in down()', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddLearningCandidateDecisionColumns20260711000000().down({
      query,
    } as never);

    const sql = query.mock.calls.map((call) => call[0] as string).join('\n');
    expect(sql).toContain('DROP COLUMN IF EXISTS rejected_by');
    expect(sql).toContain('DROP COLUMN IF EXISTS archive_reason');
  });
});
