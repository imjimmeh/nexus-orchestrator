import { describe, expect, it, vi } from 'vitest';
import { CodeChangeDedupService } from './code-change-dedup.service';

const payload = {
  title: 'Fix NUL-byte handling in outbox insert',
  description: 'NUL bytes abort the outbox INSERT and wedge the run.',
  evidence: { runIds: [], failureClasses: [], ledgerRefs: [] },
  severity: 'high' as const,
};

function buildProposal(id: string, title: string, description: string) {
  return {
    id,
    kind: 'code_change',
    status: 'pending',
    payload: { ...payload, title, description },
    occurrence_count: 1,
  };
}

function buildService(recent: unknown[]) {
  const proposals = {
    findRecentByKindAndStatuses: vi.fn().mockResolvedValue(recent),
  };
  const service = new CodeChangeDedupService(proposals as never);
  return { service, proposals };
}

describe('CodeChangeDedupService', () => {
  it('returns null when no recent code_change proposals exist', async () => {
    const { service, proposals } = buildService([]);
    await expect(service.findDuplicate(payload)).resolves.toBeNull();
    expect(proposals.findRecentByKindAndStatuses).toHaveBeenCalledWith(
      'code_change',
      ['pending', 'applied'],
      30,
    );
  });

  it('matches on normalized-title equality', async () => {
    const existing = buildProposal(
      'p-1',
      'fix nul byte handling in outbox insert!',
      'different wording',
    );
    const { service } = buildService([existing]);
    await expect(service.findDuplicate(payload)).resolves.toBe(existing);
  });

  it('returns null when no recent proposal shares the normalized title', async () => {
    const existing = buildProposal('p-3', 'Unrelated flake in web tests', 'y');
    const { service } = buildService([existing]);
    await expect(service.findDuplicate(payload)).resolves.toBeNull();
  });

  it('skips a candidate whose stored payload fails schema parsing instead of throwing', async () => {
    const malformed = {
      id: 'p-legacy',
      kind: 'code_change',
      status: 'pending',
      payload: { title: 'Fix NUL-byte handling in outbox insert' }, // missing required fields
      occurrence_count: 1,
    };
    const { service } = buildService([malformed]);

    await expect(service.findDuplicate(payload)).resolves.toBeNull();
  });

  it('still matches a valid candidate when a malformed candidate precedes it', async () => {
    const malformed = {
      id: 'p-legacy',
      kind: 'code_change',
      status: 'pending',
      payload: { title: 'Fix NUL-byte handling in outbox insert' },
      occurrence_count: 1,
    };
    const existing = buildProposal(
      'p-1',
      'fix nul byte handling in outbox insert!',
      'different wording',
    );
    const { service } = buildService([malformed, existing]);

    await expect(service.findDuplicate(payload)).resolves.toBe(existing);
  });
});
