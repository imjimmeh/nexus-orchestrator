/**
 * Unit tests for `RetrospectiveFindingsListener` (EPIC-212 Phase-2 Task 6).
 *
 * The listener is THIN: filter to the analyst workflow cheaply, extract the
 * raw findings + correlation keys from the completed run's state, and delegate
 * to `RetrospectiveAnalysisService.processFindings`. Fail-soft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RetrospectiveFindingsListener } from './retrospective-findings.listener';
import type { RetrospectiveAnalysisService } from './retrospective-analysis.service';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { WorkflowStatus } from '@nexus/core';

interface MockAnalysis {
  processFindings: ReturnType<typeof vi.fn>;
}

function createListener(): {
  listener: RetrospectiveFindingsListener;
  analysis: MockAnalysis;
} {
  const analysis: MockAnalysis = {
    processFindings: vi.fn().mockResolvedValue(undefined),
  };
  const listener = new RetrospectiveFindingsListener(
    analysis as unknown as RetrospectiveAnalysisService,
  );
  return { listener, analysis };
}

function analystEvent(
  overrides: Partial<WorkflowRunEvent> = {},
): WorkflowRunEvent {
  return {
    workflowRunId: 'analyst-run-1',
    workflowId: 'run_retrospective',
    status: WorkflowStatus.COMPLETED,
    stateVariables: {
      trigger: { workflow_run_id: 'run-1', scope_id: 'scope-1' },
      jobs: {
        analyze: {
          output: {
            findings: [
              {
                kind: 'memory',
                lesson: 'A durable lesson.',
                confidence_self: 0.5,
                evidence_event_ids: ['evt-1'],
              },
            ],
          },
        },
      },
    },
    ...overrides,
  };
}

describe('RetrospectiveFindingsListener', () => {
  let listener: RetrospectiveFindingsListener;
  let analysis: MockAnalysis;

  beforeEach(() => {
    ({ listener, analysis } = createListener());
  });

  it('ignores completion events for other workflows (cheap early return)', async () => {
    await listener.handleAnalystRunCompleted(
      analystEvent({ workflowId: 'some_other_workflow' }),
    );

    expect(analysis.processFindings).not.toHaveBeenCalled();
  });

  it('delegates the raw findings + correlation keys for an analyst run', async () => {
    await listener.handleAnalystRunCompleted(analystEvent());

    expect(analysis.processFindings).toHaveBeenCalledTimes(1);
    const arg = analysis.processFindings.mock.calls[0][0];
    expect(arg.originalRunId).toBe('run-1');
    expect(arg.scopeId).toBe('scope-1');
    expect(Array.isArray(arg.rawFindings)).toBe(true);
    expect(arg.rawFindings).toHaveLength(1);
  });

  it('delegates DB-backed analyst runs whose completion event carries the workflow row id', async () => {
    await listener.handleAnalystRunCompleted(
      analystEvent({
        workflowId: 'b36d1cdd-1b25-4509-a24c-6b0c12f445a5',
        stateVariables: {
          trigger: {
            workflow_run_id: 'run-1',
            scope_id: 'scope-1',
            agent_profile: 'retrospective-analyst',
          },
          jobs: {
            analyze: {
              output: {
                findings: [
                  {
                    kind: 'memory',
                    lesson: 'A durable lesson.',
                    confidence_self: 0.5,
                    evidence_event_ids: ['evt-1'],
                  },
                ],
              },
            },
          },
        },
      }),
    );

    expect(analysis.processFindings).toHaveBeenCalledTimes(1);
    expect(analysis.processFindings).toHaveBeenCalledWith({
      originalRunId: 'run-1',
      scopeId: 'scope-1',
      rawFindings: [
        {
          kind: 'memory',
          lesson: 'A durable lesson.',
          confidence_self: 0.5,
          evidence_event_ids: ['evt-1'],
        },
      ],
    });
  });

  it('threads the acting-agent-profile name and workflow name resolved at dispatch into processFindings (FU-16 Task A2)', async () => {
    await listener.handleAnalystRunCompleted(
      analystEvent({
        stateVariables: {
          trigger: {
            workflow_run_id: 'run-1',
            scope_id: 'scope-1',
            acting_agent_profile_name: 'implementer-agent',
            workflow_name: 'ci-workflow',
          },
          jobs: {
            analyze: {
              output: {
                findings: [
                  {
                    kind: 'memory',
                    lesson: 'A durable lesson.',
                    confidence_self: 0.5,
                    evidence_event_ids: ['evt-1'],
                  },
                ],
              },
            },
          },
        },
      }),
    );

    expect(analysis.processFindings).toHaveBeenCalledTimes(1);
    const arg = analysis.processFindings.mock.calls[0][0];
    expect(arg.actingAgentProfileName).toBe('implementer-agent');
    expect(arg.workflowName).toBe('ci-workflow');
  });

  it('omits actingAgentProfileName/workflowName from processFindings when the analyst trigger carries neither (fail-soft)', async () => {
    await listener.handleAnalystRunCompleted(analystEvent());

    const arg = analysis.processFindings.mock.calls[0][0];
    expect(arg.actingAgentProfileName).toBeUndefined();
    expect(arg.workflowName).toBeUndefined();
  });

  it('skips when the analyst run carries no correlation run id', async () => {
    await listener.handleAnalystRunCompleted(
      analystEvent({ stateVariables: { trigger: {}, jobs: {} } }),
    );

    expect(analysis.processFindings).not.toHaveBeenCalled();
  });

  it('swallows errors from processFindings (never breaks the bus)', async () => {
    analysis.processFindings.mockRejectedValueOnce(new Error('boom'));

    await expect(
      listener.handleAnalystRunCompleted(analystEvent()),
    ).resolves.toBeUndefined();
  });
});
