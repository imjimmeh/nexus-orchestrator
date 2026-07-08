import { describe, expect, it } from 'vitest';
import {
  parseAssignmentTargets,
  partitionAssignmentTargets,
} from './assignment-target.helpers';

describe('assignment-target helpers', () => {
  it('parses valid targets and drops malformed ones', () => {
    const parsed = parseAssignmentTargets([
      { type: 'agent_profile', profileName: 'ceo-agent' },
      {
        type: 'workflow_step',
        workflowName: 'auto_merge',
        stepId: 'quality_gate',
      },
      { type: 'workflow_step', workflowName: 'auto_merge' }, // whole-workflow
      { type: 'nonsense' },
      { type: 'agent_profile' }, // missing name
      42,
    ]);
    expect(parsed).toHaveLength(3);
  });

  it('partitions targets by type', () => {
    const { profileTargets, workflowTargets } = partitionAssignmentTargets([
      { type: 'agent_profile', profileName: 'a' },
      { type: 'workflow_step', workflowName: 'w', stepId: 's' },
    ]);
    expect(profileTargets).toHaveLength(1);
    expect(workflowTargets).toHaveLength(1);
  });

  it('drops duplicate targets', () => {
    const parsed = parseAssignmentTargets([
      { type: 'agent_profile', profileName: 'ceo-agent' },
      { type: 'agent_profile', profileName: 'ceo-agent' },
    ]);
    expect(parsed).toHaveLength(1);
  });

  it('returns an empty array for non-array input', () => {
    expect(parseAssignmentTargets(null)).toEqual([]);
    expect(parseAssignmentTargets(undefined)).toEqual([]);
    expect(parseAssignmentTargets({ type: 'agent_profile' })).toEqual([]);
  });
});
