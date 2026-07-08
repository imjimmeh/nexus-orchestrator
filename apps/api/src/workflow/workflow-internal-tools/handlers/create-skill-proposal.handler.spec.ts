import { describe, expect, it, vi } from 'vitest';
import { CreateSkillProposalHandler } from './create-skill-proposal.handler';

function createImprovementProposalsMock() {
  const proposalsById = new Map<
    string,
    { id: string; status: string; payload: Record<string, unknown> }
  >();
  let counter = 0;
  return {
    submitProposal: vi.fn(
      async (draft: { payload: Record<string, unknown> }) => {
        counter += 1;
        const proposal = {
          id: `proposal-${counter}`,
          status: 'pending',
          payload: draft.payload,
        };
        proposalsById.set(proposal.id, proposal);
        return { outcome: 'proposed' as const, proposal };
      },
    ),
    findPendingSkillCreateByTargetName: vi.fn(
      async (targetSkillName: string) => {
        for (const proposal of proposalsById.values()) {
          if (
            proposal.status === 'pending' &&
            proposal.payload.target_skill_name === targetSkillName
          ) {
            return proposal;
          }
        }
        return null;
      },
    ),
  };
}

function buildHandler() {
  const improvementProposals = createImprovementProposalsMock();
  const handler = new CreateSkillProposalHandler(improvementProposals as never);
  return { handler, improvementProposals };
}

describe('CreateSkillProposalHandler', () => {
  it('creates a new pending proposal on the first call', async () => {
    const { handler, improvementProposals } = buildHandler();

    const result = await handler.createSkillProposal({
      candidate_id: 'candidate-1',
      target_skill_name: 'debugging-101',
      proposal_title: 'Add debugging skill',
      proposal_summary: 'Summary of the proposed skill.',
      patch_markdown: '# Debugging 101',
    });

    expect(result).toEqual(
      expect.objectContaining({ created: true, status: 'pending' }),
    );
    expect(result.proposal_id).toBeTruthy();
    expect(improvementProposals.submitProposal).toHaveBeenCalledTimes(1);
    expect(
      improvementProposals.findPendingSkillCreateByTargetName,
    ).toHaveBeenCalledWith('debugging-101');
  });

  it('returns the same proposal id on a repeat call for the same target skill instead of creating a duplicate', async () => {
    const { handler, improvementProposals } = buildHandler();
    const params = {
      candidate_id: 'candidate-1',
      target_skill_name: 'debugging-101',
      proposal_title: 'Add debugging skill',
      proposal_summary: 'Summary of the proposed skill.',
      patch_markdown: '# Debugging 101',
    };

    const first = await handler.createSkillProposal(params);
    const second = await handler.createSkillProposal(params);

    expect(second).toEqual({
      proposal_id: first.proposal_id,
      status: 'pending',
      created: false,
    });
    expect(improvementProposals.submitProposal).toHaveBeenCalledTimes(1);
  });
});
