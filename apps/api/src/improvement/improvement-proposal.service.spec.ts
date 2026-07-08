import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ImprovementProposalService } from './improvement-proposal.service';

function makeDeps(action: 'auto_apply' | 'propose' | 'drop') {
  const rows = new Map<string, any>();
  let seq = 0;
  const repo = {
    create: vi.fn(async (input: any) => {
      const id = `p${++seq}`;
      const row = { id, occurrence_count: 1, provenance: {}, ...input };
      rows.set(id, row);
      return row;
    }),
    findById: vi.fn(async (id: string) => rows.get(id) ?? null),
    updateById: vi.fn(async (id: string, patch: any) => {
      const row = { ...rows.get(id), ...patch };
      rows.set(id, row);
      return row;
    }),
    updatePendingById: vi.fn(async (id: string, patch: any) => {
      const row = rows.get(id);
      if (!row || row.status !== 'pending') return null;
      const next = { ...row, ...patch };
      rows.set(id, next);
      return next;
    }),
  };
  const governance = { resolveAction: vi.fn(async () => action) };
  const applier = {
    kind: 'skill_create',
    apply: vi.fn(async () => ({ ok: true })),
  };
  const registry = { get: () => applier, require: () => applier };
  const ledger = { emitBestEffort: vi.fn(async () => undefined) };
  return { repo, governance, registry, ledger, applier, rows };
}

const draft = {
  kind: 'skill_create' as const,
  payload: { target_skill_name: 'x' },
  evidence: { evidenceClass: 'inference' as const },
  confidence: 0.4,
};

describe('ImprovementProposalService.submitProposal', () => {
  it('drops without persisting when governance says drop', async () => {
    const d = makeDeps('drop');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(result.outcome).toBe('dropped');
    expect(result.proposal).toBeNull();
    expect(d.repo.create).not.toHaveBeenCalled();
  });

  it('persists pending when governance says propose', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(result.outcome).toBe('proposed');
    expect(result.proposal?.status).toBe('pending');
    expect(d.applier.apply).not.toHaveBeenCalled();
  });

  it('applies immediately when governance says auto_apply', async () => {
    const d = makeDeps('auto_apply');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(result.outcome).toBe('auto_applied');
    expect(d.applier.apply).toHaveBeenCalledOnce();
    expect(result.proposal?.status).toBe('applied');
  });

  it('forwards provenance.source to governance.resolveAction (the evidence-class cap exemption hook)', async () => {
    const d = makeDeps('auto_apply');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    await svc.submitProposal({
      ...draft,
      provenance: { source: 'ui_operator' },
    });
    expect(d.governance.resolveAction).toHaveBeenCalledWith(
      expect.objectContaining({ provenanceSource: 'ui_operator' }),
    );
  });

  it('passes provenanceSource:undefined when the draft carries no provenance', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    await svc.submitProposal(draft);
    expect(d.governance.resolveAction).toHaveBeenCalledWith(
      expect.objectContaining({ provenanceSource: undefined }),
    );
  });

  it('emits a ledger audit entry for each lifecycle transition', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    await svc.submitProposal(draft);
    expect(d.ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'improvement',
        eventName: 'improvement.proposal.created',
        outcome: 'success',
      }),
    );
  });

  it('marks the proposal failed (not applied) when the applier reports ok:false', async () => {
    const d = makeDeps('auto_apply');
    d.applier.apply.mockResolvedValueOnce({
      ok: false,
      detail: 'applier boom',
    } as any);
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(result.outcome).toBe('apply_failed');
    expect(result.proposal?.status).toBe('failed');
    expect(result.proposal?.provenance.apply_error).toBe('applier boom');
  });

  it('marks the proposal failed when the applier throws', async () => {
    const d = makeDeps('auto_apply');
    d.applier.apply.mockRejectedValueOnce(new Error('network down'));
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(result.outcome).toBe('apply_failed');
    expect(result.proposal?.status).toBe('failed');
    expect(result.proposal?.provenance.apply_error).toContain('network down');
  });
});

describe('ImprovementProposalService auto-rollback on apply failure', () => {
  const SNAPSHOT = { restore: 'me' };

  /**
   * Makes `apply()` persist a pre-mutation snapshot (mirroring the real
   * appliers' `persistRollbackSnapshotOnce`) and then fail the requested way,
   * so the service's post-failure re-read sees a non-null `rollback_data`.
   */
  function persistSnapshotThen(
    d: ReturnType<typeof makeDeps>,
    fail: { throws: Error } | { ok: false; detail: string },
  ) {
    d.applier.apply.mockImplementationOnce(async (proposal: any) => {
      proposal.rollback_data = SNAPSHOT;
      await d.repo.updateById(proposal.id, { rollback_data: SNAPSHOT });
      if ('throws' in fail) throw fail.throws;
      return { ok: fail.ok, detail: fail.detail };
    });
  }

  it('invokes the applier rollback when apply() throws after persisting a snapshot', async () => {
    const d = makeDeps('auto_apply');
    d.applier.rollback = vi.fn(async () => undefined);
    persistSnapshotThen(d, { throws: new Error('network down') });
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(d.applier.rollback).toHaveBeenCalledOnce();
    expect(result.proposal?.status).toBe('failed');
  });

  it('invokes the applier rollback when apply() returns ok:false after persisting a snapshot', async () => {
    const d = makeDeps('auto_apply');
    d.applier.rollback = vi.fn(async () => undefined);
    persistSnapshotThen(d, { ok: false, detail: 'bad payload' });
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(d.applier.rollback).toHaveBeenCalledOnce();
    expect(result.proposal?.status).toBe('failed');
  });

  it('does NOT attempt rollback for a pre-mutation ok:false failure (no snapshot persisted)', async () => {
    const d = makeDeps('auto_apply');
    d.applier.rollback = vi.fn(async () => undefined);
    // Fails before any snapshot is persisted — rollback_data stays undefined.
    d.applier.apply.mockResolvedValueOnce({
      ok: false,
      detail: 'invalid payload',
    } as any);
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(d.applier.rollback).not.toHaveBeenCalled();
    expect(result.proposal?.status).toBe('failed');
  });

  it('does NOT attempt rollback for a pre-mutation throw (no snapshot persisted)', async () => {
    const d = makeDeps('auto_apply');
    d.applier.rollback = vi.fn(async () => undefined);
    d.applier.apply.mockRejectedValueOnce(new Error('target not found'));
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(d.applier.rollback).not.toHaveBeenCalled();
    expect(result.proposal?.status).toBe('failed');
  });

  it('still marks the proposal failed (without throwing) when rollback itself throws', async () => {
    const d = makeDeps('auto_apply');
    d.applier.rollback = vi
      .fn()
      .mockRejectedValueOnce(new Error('rollback boom'));
    persistSnapshotThen(d, { throws: new Error('network down') });
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(d.applier.rollback).toHaveBeenCalledOnce();
    expect(result.proposal?.status).toBe('failed');
    expect(result.proposal?.provenance.apply_error).toContain('network down');
  });

  it('does not attempt rollback when the applier does not implement it (even with a snapshot)', async () => {
    const d = makeDeps('auto_apply');
    // A snapshot IS persisted, so the absent-snapshot guard would NOT
    // short-circuit — non-invocation must come from the `typeof rollback`
    // guard alone. `d.applier` has no `rollback` method. Without that guard
    // the service would call `undefined(...)`, the inner catch would swallow
    // the TypeError, and a "best-effort rollback ... failed" warn would fire —
    // so asserting that warn is ABSENT pins the guard precisely.
    persistSnapshotThen(d, { throws: new Error('network down') });
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const svc = new ImprovementProposalService(
        d.repo as any,
        d.governance as any,
        d.registry as any,
        d.ledger as any,
      );
      const result = await svc.submitProposal(draft);
      expect(result.proposal?.status).toBe('failed');
      const warnMessages = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(
        warnMessages.some((message) =>
          message.includes('best-effort rollback'),
        ),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('ImprovementProposalService.approve', () => {
  it('moves a pending proposal to applied via the applier', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);
    const approved = await svc.approve(proposal!.id);
    expect(approved.status).toBe('applied');
    expect(d.applier.apply).toHaveBeenCalledOnce();
  });

  it('throws ConflictException when the proposal is not pending', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);
    await svc.approve(proposal!.id);
    await expect(svc.approve(proposal!.id)).rejects.toThrow(/not pending/);
  });

  it('throws NotFoundException for an unknown id', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    await expect(svc.approve('missing')).rejects.toThrow(/not found/);
  });
});

describe('ImprovementProposalService.reject', () => {
  it('moves a pending proposal to rejected', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);
    const rejected = await svc.reject(proposal!.id);
    expect(rejected.status).toBe('rejected');
    expect(d.applier.apply).not.toHaveBeenCalled();
  });

  it('throws ConflictException when the proposal is not pending', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);
    await svc.reject(proposal!.id);
    await expect(svc.reject(proposal!.id)).rejects.toThrow(/not pending/);
  });

  it('persists the reason to provenance.reject_reason and includes it in the audit payload', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);
    const rejected = await svc.reject(proposal!.id, 'duplicate of p1');

    expect(rejected.provenance.reject_reason).toBe('duplicate of p1');
    expect(d.rows.get(proposal!.id).provenance.reject_reason).toBe(
      'duplicate of p1',
    );
    expect(d.ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'improvement.proposal.rejected',
        payload: expect.objectContaining({ reason: 'duplicate of p1' }),
      }),
    );
  });

  it('leaves provenance.reject_reason absent when no reason is given', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);
    const rejected = await svc.reject(proposal!.id);

    expect(rejected.provenance.reject_reason).toBeUndefined();
    expect(d.ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'improvement.proposal.rejected',
        payload: expect.not.objectContaining({ reason: expect.anything() }),
      }),
    );
  });
});

describe('ImprovementProposalService.rollback', () => {
  it('rolls back an applied proposal via the applier', async () => {
    const d = makeDeps('auto_apply');
    d.applier.rollback = vi.fn(async () => undefined);
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);
    const rolledBack = await svc.rollback(proposal!.id);
    expect(rolledBack.status).toBe('rolled_back');
    expect(rolledBack.rolled_back_at).toBeInstanceOf(Date);
    expect(d.applier.rollback).toHaveBeenCalledOnce();
  });

  it('throws ConflictException when the proposal is not applied', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);
    await expect(svc.rollback(proposal!.id)).rejects.toThrow(/not applied/);
  });

  it('throws ConflictException when the applier does not support rollback', async () => {
    const d = makeDeps('auto_apply');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);
    await expect(svc.rollback(proposal!.id)).rejects.toThrow(
      /does not support rollback/,
    );
  });

  it('throws NotFoundException for an unknown id', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    await expect(svc.rollback('missing')).rejects.toThrow(/not found/);
  });
});

describe('ImprovementProposalService.getById', () => {
  it('returns the proposal when it exists', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);
    const found = await svc.getById(proposal!.id);
    expect(found).toEqual(proposal);
  });

  it('throws NotFoundException for an unknown id', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    await expect(svc.getById('missing')).rejects.toThrow(/not found/);
  });
});

describe('ImprovementProposalService.list', () => {
  it('delegates to the repository', async () => {
    const d = makeDeps('propose');
    d.repo.list = vi.fn(async () => ({ data: [], total: 0 }));
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const filter = { kinds: ['code_change' as const] };
    const result = await svc.list(filter);
    expect(d.repo.list).toHaveBeenCalledWith(filter);
    expect(result).toEqual({ data: [], total: 0 });
  });
});

describe('ImprovementProposalService.bulkApprove', () => {
  it('approves each pending proposal and reports per-id success', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const first = await svc.submitProposal(draft);
    const second = await svc.submitProposal(draft);

    const results = await svc.bulkApprove([
      first.proposal!.id,
      second.proposal!.id,
    ]);

    expect(results).toEqual([
      {
        id: first.proposal!.id,
        status: 'approved',
        proposal: expect.objectContaining({ status: 'applied' }),
      },
      {
        id: second.proposal!.id,
        status: 'approved',
        proposal: expect.objectContaining({ status: 'applied' }),
      },
    ]);
  });

  it('reports per-id failure without aborting the remaining ids', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);

    const results = await svc.bulkApprove(['missing', proposal!.id]);

    expect(results).toEqual([
      {
        id: 'missing',
        status: 'failed',
        proposal: null,
        error: expect.stringContaining('not found'),
      },
      {
        id: proposal!.id,
        status: 'approved',
        proposal: expect.objectContaining({ status: 'applied' }),
      },
    ]);
  });
});

describe('ImprovementProposalService.bulkReject', () => {
  it('rejects each pending proposal and reports per-id success', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const first = await svc.submitProposal(draft);
    const second = await svc.submitProposal(draft);

    const results = await svc.bulkReject([
      first.proposal!.id,
      second.proposal!.id,
    ]);

    expect(results).toEqual([
      {
        id: first.proposal!.id,
        status: 'rejected',
        proposal: expect.objectContaining({ status: 'rejected' }),
      },
      {
        id: second.proposal!.id,
        status: 'rejected',
        proposal: expect.objectContaining({ status: 'rejected' }),
      },
    ]);
    expect(d.applier.apply).not.toHaveBeenCalled();
  });

  it('reports per-id failure without aborting the remaining ids', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const { proposal } = await svc.submitProposal(draft);

    const results = await svc.bulkReject(['missing', proposal!.id]);

    expect(results).toEqual([
      {
        id: 'missing',
        status: 'failed',
        proposal: null,
        error: expect.stringContaining('not found'),
      },
      {
        id: proposal!.id,
        status: 'rejected',
        proposal: expect.objectContaining({ status: 'rejected' }),
      },
    ]);
  });

  it('propagates the reason to each rejected proposal provenance', async () => {
    const d = makeDeps('propose');
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const first = await svc.submitProposal(draft);
    const second = await svc.submitProposal(draft);

    const results = await svc.bulkReject(
      [first.proposal!.id, second.proposal!.id],
      'batch cleanup',
    );

    expect((results[0].proposal as any)?.provenance.reject_reason).toBe(
      'batch cleanup',
    );
    expect((results[1].proposal as any)?.provenance.reject_reason).toBe(
      'batch cleanup',
    );
    expect(d.rows.get(first.proposal!.id).provenance.reject_reason).toBe(
      'batch cleanup',
    );
    expect(d.rows.get(second.proposal!.id).provenance.reject_reason).toBe(
      'batch cleanup',
    );
  });
});
