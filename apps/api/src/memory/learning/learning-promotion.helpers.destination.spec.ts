import { describe, expect, it } from 'vitest';
import { resolveSegmentDestination } from './learning-promotion.helpers';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { GovernanceDecision } from './promotion-governance-policy.types';

const governance: GovernanceDecision = {
  autoPromote: true,
  governanceState: 'provisional',
  probationUntil: new Date('2026-07-16T00:00:00.000Z'),
  requiresProposal: false,
  drop: false,
  reason: 'test',
};

function candidate(overrides: Partial<LearningCandidate>): LearningCandidate {
  return {
    scope_type: 'workflow',
    scopeId: 'implementation_workflow',
    routing_target: 'workflow',
    signals_json: {},
    ...overrides,
  } as LearningCandidate;
}

describe('resolveSegmentDestination — workflow routing target (Epic C)', () => {
  it('lands on a workflow-scoped fact segment keyed by the workflow definition name', () => {
    const destination = resolveSegmentDestination(candidate({}), governance);

    expect(destination).toEqual({
      entityType: 'workflow',
      entityId: 'implementation_workflow',
      memoryType: 'fact',
      governanceState: 'provisional',
      probationUntil: governance.probationUntil,
    });
  });

  it('falls back to provenance workflowName when scopeId is blank', () => {
    const destination = resolveSegmentDestination(
      candidate({
        scopeId: null,
        signals_json: { provenance: { workflowName: 'run_retrospective' } },
      }),
      governance,
    );

    expect(destination.entityType).toBe('workflow');
    expect(destination.entityId).toBe('run_retrospective');
  });
});
