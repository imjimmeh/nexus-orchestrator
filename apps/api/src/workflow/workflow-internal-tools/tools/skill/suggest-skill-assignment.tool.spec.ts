import { describe, expect, it, vi } from 'vitest';
import { handleSuggestSkillAssignment } from './suggest-skill-assignment.tool';

describe('suggest_skill_assignment', () => {
  it('files a skill_assignment proposal from tool input + run context', async () => {
    const service = {
      submitProposal: vi.fn(async () => ({
        outcome: 'proposed',
        proposal: { id: 'p1' },
      })),
    };
    const result = await handleSuggestSkillAssignment(
      {
        skill_name: 'merge-doctor',
        targets: [{ type: 'agent_profile', profileName: 'merge-agent' }],
      },
      { runId: 'r1', agentProfileName: 'merge-agent' },
      service as any,
    );
    expect(service.submitProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'skill_assignment',
        payload: expect.objectContaining({ skillName: 'merge-doctor' }),
      }),
    );
    expect(result).toMatchObject({ proposalId: 'p1' });
  });

  it('never assigns directly: the payload only carries the proposed targets, evidence is inference, and provenance identifies the tool + caller', async () => {
    const service = {
      submitProposal: vi.fn(async () => ({
        outcome: 'proposed',
        proposal: { id: 'p2' },
      })),
    };

    await handleSuggestSkillAssignment(
      {
        skill_name: 'merge-doctor',
        targets: [{ type: 'agent_profile', profileName: 'merge-agent' }],
        rationale: 'agent keeps re-deriving this manually',
      },
      { runId: 'r1', agentProfileName: 'merge-agent' },
      service as any,
    );

    expect(service.submitProposal).toHaveBeenCalledWith({
      kind: 'skill_assignment',
      payload: {
        skillName: 'merge-doctor',
        assignment_targets: [
          { type: 'agent_profile', profileName: 'merge-agent' },
        ],
        rationale: 'agent keeps re-deriving this manually',
      },
      evidence: { evidenceClass: 'inference' },
      confidence: expect.any(Number),
      provenance: {
        tool: 'suggest_skill_assignment',
        runId: 'r1',
        agentProfileName: 'merge-agent',
      },
    });
  });

  it.each([
    ['auto_applied' as const, 'auto_applied' as const],
    ['proposed' as const, 'proposed' as const],
    ['apply_failed' as const, 'apply_failed' as const],
  ])(
    "maps submitProposal outcome '%s' onto the agent-facing status '%s'",
    async (outcome, expectedStatus) => {
      const service = {
        submitProposal: vi.fn(async () => ({
          outcome,
          proposal: { id: 'p3' },
        })),
      };

      const result = await handleSuggestSkillAssignment(
        {
          skill_name: 'merge-doctor',
          targets: [{ type: 'agent_profile', profileName: 'merge-agent' }],
        },
        { runId: 'r1' },
        service as any,
      );

      expect(result).toEqual({
        status: expectedStatus,
        proposalId: 'p3',
        created: true,
      });
    },
  );

  it('reports a dropped proposal (governance dropped it, no proposal row) without a proposalId', async () => {
    const service = {
      submitProposal: vi.fn(async () => ({
        outcome: 'dropped',
        proposal: null,
      })),
    };

    const result = await handleSuggestSkillAssignment(
      {
        skill_name: 'merge-doctor',
        targets: [{ type: 'agent_profile', profileName: 'merge-agent' }],
      },
      { runId: 'r1' },
      service as any,
    );

    expect(result).toEqual({
      status: 'dropped',
      proposalId: null,
      created: false,
    });
  });

  it('rejects malformed targets up front and never calls submitProposal', async () => {
    const service = { submitProposal: vi.fn() };

    const result = await handleSuggestSkillAssignment(
      {
        skill_name: 'merge-doctor',
        // Missing the required discriminator field for either target kind.
        targets: [{ type: 'agent_profile' }, { not_a_target: true }] as any,
      },
      { runId: 'r1' },
      service,
    );

    expect(service.submitProposal).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'rejected',
      proposalId: null,
      created: false,
      reason: 'no valid assignment targets',
    });
  });

  it('drops malformed entries but still files the proposal when at least one target is valid', async () => {
    const service = {
      submitProposal: vi.fn(async () => ({
        outcome: 'proposed',
        proposal: { id: 'p4' },
      })),
    };

    await handleSuggestSkillAssignment(
      {
        skill_name: 'merge-doctor',
        targets: [
          { type: 'agent_profile', profileName: 'merge-agent' },
          { type: 'agent_profile' },
        ] as any,
      },
      { runId: 'r1' },
      service as any,
    );

    expect(service.submitProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          assignment_targets: [
            { type: 'agent_profile', profileName: 'merge-agent' },
          ],
        }),
      }),
    );
  });
});
