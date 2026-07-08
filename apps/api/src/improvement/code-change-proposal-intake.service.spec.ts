import { describe, expect, it, vi } from 'vitest';
import { CodeChangeProposalIntakeService } from './code-change-proposal-intake.service';

const draft = {
  kind: 'code_change' as const,
  payload: {
    title: 'Fix NUL-byte handling in outbox insert',
    description: 'NUL bytes abort the outbox INSERT and wedge the run.',
    evidence: {
      runIds: ['run-1'],
      failureClasses: ['outbox_insert_failed'],
      ledgerRefs: [],
    },
    severity: 'high' as const,
  },
  evidence: {
    evidenceClass: 'inference' as const,
    runIds: ['run-1'],
    failureClasses: ['outbox_insert_failed'],
    ledgerRefs: [],
  },
  confidence: 0.6,
  provenance: { source: 'spec' },
};

function buildService(duplicate: { id: string } | null) {
  const dedup = { findDuplicate: vi.fn().mockResolvedValue(duplicate) };
  const proposals = {
    bumpOccurrence: vi
      .fn()
      .mockResolvedValue(
        duplicate ? { ...duplicate, occurrence_count: 2 } : null,
      ),
  };
  const proposalService = {
    submitProposal: vi.fn().mockResolvedValue({
      outcome: 'proposed',
      proposal: { id: 'new-1', occurrence_count: 1 },
    }),
  };
  const service = new CodeChangeProposalIntakeService(
    dedup as never,
    proposals as never,
    proposalService as never,
  );
  return { service, dedup, proposals, proposalService };
}

describe('CodeChangeProposalIntakeService', () => {
  it('bumps occurrence_count on a duplicate instead of creating a proposal', async () => {
    const { service, proposals, proposalService } = buildService({
      id: 'p-1',
    });

    const result = await service.submitCodeChangeProposal(draft);

    expect(result.deduplicated).toBe(true);
    expect(proposals.bumpOccurrence).toHaveBeenCalledWith('p-1');
    expect(proposalService.submitProposal).not.toHaveBeenCalled();
    expect(result.proposal).toEqual({ id: 'p-1', occurrence_count: 2 });
  });

  it('submits a new proposal when no duplicate is found', async () => {
    const { service, proposals, proposalService } = buildService(null);

    const result = await service.submitCodeChangeProposal(draft);

    expect(result.deduplicated).toBe(false);
    expect(proposalService.submitProposal).toHaveBeenCalledWith(draft);
    expect(proposals.bumpOccurrence).not.toHaveBeenCalled();
    expect(result.proposal).toEqual({ id: 'new-1', occurrence_count: 1 });
  });

  it('rejects a draft whose payload fails the code_change schema', async () => {
    const { service } = buildService(null);
    await expect(
      service.submitCodeChangeProposal({
        ...draft,
        payload: { title: '' },
      }),
    ).rejects.toThrow();
  });

  it('propagates a null proposal when governance drops the new submission', async () => {
    const { service, proposalService } = buildService(null);
    proposalService.submitProposal.mockResolvedValueOnce({
      outcome: 'dropped',
      proposal: null,
    });

    const result = await service.submitCodeChangeProposal(draft);

    expect(result.deduplicated).toBe(false);
    expect(result.proposal).toBeNull();
  });
});
