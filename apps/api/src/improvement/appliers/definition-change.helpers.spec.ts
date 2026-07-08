import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { ImprovementProposal } from '../database/entities/improvement-proposal.entity';
import {
  buildImprovementOverridesMarker,
  IMPROVEMENT_OVERRIDES_KEY,
  persistRollbackSnapshotOnce,
} from './definition-change.helpers';

describe('buildImprovementOverridesMarker', () => {
  it('produces a non-null object carrying proposal provenance', () => {
    const marker = buildImprovementOverridesMarker(
      null,
      'prop-1',
      '2026-07-02T00:00:00.000Z',
    );
    expect(marker[IMPROVEMENT_OVERRIDES_KEY]).toEqual({
      proposal_id: 'prop-1',
      applied_at: '2026-07-02T00:00:00.000Z',
    });
  });

  it('preserves pre-existing override keys', () => {
    const marker = buildImprovementOverridesMarker(
      { admin_custom: true },
      'prop-1',
      'x',
    );
    expect(marker.admin_custom).toBe(true);
  });
});

describe('persistRollbackSnapshotOnce', () => {
  it('writes the snapshot when rollback_data is null', async () => {
    const repository = { update: vi.fn().mockResolvedValue(undefined) };
    const proposal = {
      id: 'prop-1',
      rollback_data: null,
    } as unknown as ImprovementProposal;
    await persistRollbackSnapshotOnce(
      repository as unknown as Repository<ImprovementProposal>,
      proposal,
      { yaml_definition: 'old' },
    );
    expect(repository.update).toHaveBeenCalledWith('prop-1', {
      rollback_data: { yaml_definition: 'old' },
    });
    expect(proposal.rollback_data).toEqual({ yaml_definition: 'old' });
  });

  it('never overwrites an existing snapshot (retry idempotency)', async () => {
    const repository = { update: vi.fn() };
    const proposal = {
      id: 'prop-1',
      rollback_data: { yaml_definition: 'original' },
    } as unknown as ImprovementProposal;
    await persistRollbackSnapshotOnce(
      repository as unknown as Repository<ImprovementProposal>,
      proposal,
      { yaml_definition: 'post-mutation-state' },
    );
    expect(repository.update).not.toHaveBeenCalled();
    expect(proposal.rollback_data).toEqual({ yaml_definition: 'original' });
  });
});
