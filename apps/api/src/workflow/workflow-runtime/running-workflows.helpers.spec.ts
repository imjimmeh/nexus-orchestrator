import { describe, expect, it } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import { mapRunningWorkflowSummaries } from './running-workflows.helpers';
import type { RunningWorkflowRunRecord } from './running-workflows.types';

const NOW_MS = Date.parse('2026-06-12T10:40:00.000Z');

function run(
  overrides: Partial<RunningWorkflowRunRecord>,
): RunningWorkflowRunRecord {
  return {
    id: 'run-1',
    workflow_id: 'wf-uuid-1',
    status: WorkflowStatus.RUNNING,
    wait_reason: null,
    state_variables: {},
    created_at: new Date('2026-06-12T10:38:00.000Z'),
    ...overrides,
  };
}

describe('mapRunningWorkflowSummaries', () => {
  it('maps runs to neutral summaries with resolved names and ages', () => {
    const namesById = new Map([
      ['wf-uuid-1', 'Project Backlog Generation (CEO)'],
    ]);

    const summaries = mapRunningWorkflowSummaries(
      [run({ id: 'run-a' })],
      namesById,
      NOW_MS,
    );

    expect(summaries).toEqual([
      {
        runId: 'run-a',
        workflowName: 'Project Backlog Generation (CEO)',
        status: 'RUNNING',
        ageSeconds: 120,
      },
    ]);
  });

  it('falls back to the workflow id when the name is unknown', () => {
    const summaries = mapRunningWorkflowSummaries(
      [run({ workflow_id: 'wf-uuid-x' })],
      new Map(),
      NOW_MS,
    );

    expect(summaries[0]?.workflowName).toBe('wf-uuid-x');
  });

  it('includes wait reason and parent linkage when available', () => {
    const summaries = mapRunningWorkflowSummaries(
      [
        run({
          wait_reason: 'dependency',
          state_variables: { trigger: { parentRunId: 'cycle-9' } },
        }),
      ],
      new Map(),
      NOW_MS,
    );

    expect(summaries[0]?.waitReason).toBe('dependency');
    expect(summaries[0]?.parentRunId).toBe('cycle-9');
  });

  it('excludes the calling run so an agent never sees itself', () => {
    const summaries = mapRunningWorkflowSummaries(
      [run({ id: 'self' }), run({ id: 'other' })],
      new Map(),
      NOW_MS,
      { excludeRunId: 'self' },
    );

    expect(summaries.map((s) => s.runId)).toEqual(['other']);
  });

  it('applies the limit after exclusion, keeping oldest first', () => {
    const summaries = mapRunningWorkflowSummaries(
      [
        run({ id: 'newest', created_at: new Date('2026-06-12T10:39:00.000Z') }),
        run({ id: 'oldest', created_at: new Date('2026-06-12T10:30:00.000Z') }),
        run({ id: 'middle', created_at: new Date('2026-06-12T10:35:00.000Z') }),
      ],
      new Map(),
      NOW_MS,
      { limit: 2 },
    );

    expect(summaries.map((s) => s.runId)).toEqual(['oldest', 'middle']);
  });

  it('ignores an unknown wait reason value defensively', () => {
    const summaries = mapRunningWorkflowSummaries(
      [run({ wait_reason: 'bogus' })],
      new Map(),
      NOW_MS,
    );

    expect(summaries[0]?.waitReason).toBeUndefined();
  });
});
