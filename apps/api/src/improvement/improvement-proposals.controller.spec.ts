import { describe, expect, it, vi } from 'vitest';
import { ImprovementProposalsController } from './improvement-proposals.controller';

describe('ImprovementProposalsController', () => {
  it('approve delegates to the service and wraps success', async () => {
    const service = {
      approve: vi.fn(async () => ({ id: 'p1', status: 'applied' })),
    };
    const controller = new ImprovementProposalsController(service as any);
    const res = await controller.approve('p1');
    expect(service.approve).toHaveBeenCalledWith('p1');
    expect(res).toEqual({
      success: true,
      data: { id: 'p1', status: 'applied' },
    });
  });

  it('create delegates to submitProposal with operator provenance and returns the outcome', async () => {
    const service = {
      submitProposal: vi.fn(async () => ({
        outcome: 'auto_applied',
        proposal: { id: 'p1', status: 'applied' },
      })),
    };
    const controller = new ImprovementProposalsController(service as any);
    const res = await controller.create({
      skillName: 'merge-doctor',
      targets: [{ type: 'agent_profile', profileName: 'merge-agent' }],
    } as any);
    expect(service.submitProposal).toHaveBeenCalledWith({
      kind: 'skill_assignment',
      payload: {
        skillName: 'merge-doctor',
        assignment_targets: [
          { type: 'agent_profile', profileName: 'merge-agent' },
        ],
      },
      evidence: { evidenceClass: 'inference' },
      confidence: 1,
      provenance: { source: 'ui_operator' },
    });
    expect(res).toEqual({
      success: true,
      outcome: 'auto_applied',
      data: { id: 'p1', status: 'applied' },
    });
  });

  it('create includes an optional rationale in the payload when supplied', async () => {
    const service = {
      submitProposal: vi.fn(async () => ({
        outcome: 'proposed',
        proposal: { id: 'p2', status: 'pending' },
      })),
    };
    const controller = new ImprovementProposalsController(service as any);
    await controller.create({
      skillName: 'merge-doctor',
      targets: [{ type: 'agent_profile', profileName: 'merge-agent' }],
      rationale: 'operator wants this bound explicitly',
    } as any);
    expect(service.submitProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          rationale: 'operator wants this bound explicitly',
        }),
      }),
    );
  });

  it('create returns a null data field when governance drops the draft', async () => {
    const service = {
      submitProposal: vi.fn(async () => ({
        outcome: 'dropped',
        proposal: null,
      })),
    };
    const controller = new ImprovementProposalsController(service as any);
    const res = await controller.create({
      skillName: 'merge-doctor',
      targets: [{ type: 'agent_profile', profileName: 'merge-agent' }],
    } as any);
    expect(res).toEqual({ success: true, outcome: 'dropped', data: null });
  });

  it('list forwards filters to the service', async () => {
    const service = {
      list: vi.fn(async () => ({ data: [], total: 0 })),
    };
    const controller = new ImprovementProposalsController(service as any);
    const res = await controller.list({
      kind: ['code_change'],
      status: ['pending'],
      page: 1,
      limit: 20,
    } as any);
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({
        kinds: ['code_change'],
        statuses: ['pending'],
      }),
    );
    expect(res.success).toBe(true);
  });

  it('reject delegates to the service and wraps success', async () => {
    const service = {
      reject: vi.fn(async () => ({ id: 'p1', status: 'rejected' })),
    };
    const controller = new ImprovementProposalsController(service as any);
    const res = await controller.reject('p1');
    expect(service.reject).toHaveBeenCalledWith('p1');
    expect(res).toEqual({
      success: true,
      data: { id: 'p1', status: 'rejected' },
    });
  });

  it('rollback delegates to the service and wraps success', async () => {
    const service = {
      rollback: vi.fn(async () => ({ id: 'p1', status: 'rolled_back' })),
    };
    const controller = new ImprovementProposalsController(service as any);
    const res = await controller.rollback('p1');
    expect(service.rollback).toHaveBeenCalledWith('p1');
    expect(res).toEqual({
      success: true,
      data: { id: 'p1', status: 'rolled_back' },
    });
  });

  it('bulkApprove delegates to the service and wraps success', async () => {
    const outcomes = [{ id: 'p1', status: 'approved', proposal: {} }];
    const service = { bulkApprove: vi.fn(async () => outcomes) };
    const controller = new ImprovementProposalsController(service as any);
    const res = await controller.bulkApprove({ proposal_ids: ['p1'] });
    expect(service.bulkApprove).toHaveBeenCalledWith(['p1']);
    expect(res).toEqual({ success: true, data: outcomes });
  });

  it('bulkReject delegates to the service and wraps success', async () => {
    const outcomes = [{ id: 'p1', status: 'rejected', proposal: {} }];
    const service = { bulkReject: vi.fn(async () => outcomes) };
    const controller = new ImprovementProposalsController(service as any);
    const res = await controller.bulkReject({
      proposal_ids: ['p1'],
      reason: 'stale',
    });
    expect(service.bulkReject).toHaveBeenCalledWith(['p1'], 'stale');
    expect(res).toEqual({ success: true, data: outcomes });
  });

  it('get returns the proposal wrapped in a success envelope', async () => {
    const service = {
      getById: vi.fn(async () => ({ id: 'p1', status: 'pending' })),
    };
    const controller = new ImprovementProposalsController(service as any);
    const res = await controller.get('p1');
    expect(service.getById).toHaveBeenCalledWith('p1');
    expect(res).toEqual({
      success: true,
      data: { id: 'p1', status: 'pending' },
    });
  });

  it('get propagates NotFoundException raised by the service', async () => {
    const service = {
      getById: vi.fn(async () => {
        throw new Error('Proposal missing not found');
      }),
    };
    const controller = new ImprovementProposalsController(service as any);
    await expect(controller.get('missing')).rejects.toThrow(/not found/i);
  });
});
