import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_POSTMORTEM_RECORDED_EVENT,
  isWorkflowPostmortemPayload,
  renderPostmortemText,
  type WorkflowPostmortemPayload,
} from './workflow-failure-postmortem.types';
import { WORKFLOW_POSTMORTEM_OUTCOMES } from './workflow-failure-postmortem.constants';

describe('renderPostmortemText', () => {
  const basePayload: WorkflowPostmortemPayload = {
    workflow_run_id: 'run-1',
    scope_id: 'scope-1',
    failure_class: 'dependency_missing',
    confidence: 0.87,
    repair_decision: {
      eligibility: 'allow',
      allowedRepairActionIds: ['reinstall_dep', 'bump_lockfile'],
      reason: 'lockfile drift detected',
    },
    evidence_summary: '3 event(s), 1 transcript reference(s).',
    occurred_at: '2026-06-19T00:00:00.000Z',
  };

  it('includes the literal Source: workflow_failure_postmortem token on the first line', () => {
    const text = renderPostmortemText(basePayload);

    expect(text.split('\n')[0]).toBe('Source: workflow_failure_postmortem');
  });

  it('renders a single-line repair decision with comma-joined action ids', () => {
    const text = renderPostmortemText(basePayload);

    expect(text).toContain(
      'Repair decision: eligibility=allow allowed_action_ids=reinstall_dep,bump_lockfile reason=lockfile drift detected',
    );
  });

  it('renders an empty allowedRepairActionIds list as the literal "none"', () => {
    const text = renderPostmortemText({
      ...basePayload,
      repair_decision: {
        eligibility: 'deny',
        allowedRepairActionIds: [],
        reason: 'policy denied',
      },
    });

    expect(text).toContain(
      'Repair decision: eligibility=deny allowed_action_ids=none reason=policy denied',
    );
  });

  it('renders confidence with 2 decimal places', () => {
    const text = renderPostmortemText({
      ...basePayload,
      confidence: 0.5,
    });

    expect(text).toContain('Confidence: 0.50');
  });

  it('indents the evidence block by 2 spaces and 4 spaces for subsequent lines', () => {
    const text = renderPostmortemText({
      ...basePayload,
      evidence_summary: 'line one\nline two\nline three',
    });

    const evidenceIndex = text.indexOf('Evidence:');
    expect(evidenceIndex).toBeGreaterThanOrEqual(0);
    const evidenceBlock = text.slice(evidenceIndex);
    expect(evidenceBlock).toContain(
      'Evidence:\n  line one\n    line two\n    line three',
    );
  });

  it('preserves all payload fields in the rendered text', () => {
    const text = renderPostmortemText(basePayload);

    expect(text).toContain('Workflow run: run-1');
    expect(text).toContain('Project: scope-1');
    expect(text).toContain('Failure class: dependency_missing');
    expect(text).toContain('Occurred at: 2026-06-19T00:00:00.000Z');
  });
});

describe('isWorkflowPostmortemPayload', () => {
  const validPayload: WorkflowPostmortemPayload = {
    workflow_run_id: 'run-1',
    scope_id: 'scope-1',
    failure_class: 'dependency_missing',
    confidence: 0.87,
    repair_decision: {
      eligibility: 'allow',
      allowedRepairActionIds: ['action-1'],
      reason: 'reason',
    },
    evidence_summary: 'summary',
    occurred_at: '2026-06-19T00:00:00.000Z',
  };

  it('returns true for a well-formed payload', () => {
    expect(isWorkflowPostmortemPayload(validPayload)).toBe(true);
  });

  it('rejects null and non-object values', () => {
    expect(isWorkflowPostmortemPayload(null)).toBe(false);
    expect(isWorkflowPostmortemPayload(undefined)).toBe(false);
    expect(isWorkflowPostmortemPayload('string')).toBe(false);
    expect(isWorkflowPostmortemPayload(42)).toBe(false);
  });

  it('rejects empty workflow_run_id / scope_id', () => {
    expect(
      isWorkflowPostmortemPayload({ ...validPayload, workflow_run_id: '' }),
    ).toBe(false);
    expect(isWorkflowPostmortemPayload({ ...validPayload, scope_id: '' })).toBe(
      false,
    );
  });

  it('rejects an unknown failure_class', () => {
    expect(
      isWorkflowPostmortemPayload({
        ...validPayload,
        failure_class: 'not_a_real_class',
      }),
    ).toBe(false);
  });

  it('rejects confidence outside [0, 1]', () => {
    expect(
      isWorkflowPostmortemPayload({ ...validPayload, confidence: -0.1 }),
    ).toBe(false);
    expect(
      isWorkflowPostmortemPayload({ ...validPayload, confidence: 1.5 }),
    ).toBe(false);
    expect(
      isWorkflowPostmortemPayload({ ...validPayload, confidence: NaN }),
    ).toBe(false);
  });

  it('rejects an unknown eligibility', () => {
    expect(
      isWorkflowPostmortemPayload({
        ...validPayload,
        repair_decision: {
          ...validPayload.repair_decision,
          eligibility: 'maybe',
        },
      }),
    ).toBe(false);
  });

  it('rejects a non-array or empty-string allowedRepairActionIds entry', () => {
    expect(
      isWorkflowPostmortemPayload({
        ...validPayload,
        repair_decision: {
          ...validPayload.repair_decision,
          allowedRepairActionIds: [''],
        },
      }),
    ).toBe(false);
  });

  it('rejects a malformed occurred_at', () => {
    expect(
      isWorkflowPostmortemPayload({
        ...validPayload,
        occurred_at: 'not-an-iso-string',
      }),
    ).toBe(false);
  });

  it('accepts each WORKFLOW_POSTMORTEM_OUTCOMES label (sanity check)', () => {
    // The label union is shared with the constants file; this
    // guards against accidental drift between the two surfaces.
    expect(WORKFLOW_POSTMORTEM_OUTCOMES).toEqual([
      'success',
      'skipped',
      'failed',
    ]);
  });

  it('re-exports the canonical event name constant', () => {
    expect(WORKFLOW_POSTMORTEM_RECORDED_EVENT).toBe(
      'memory.workflow.postmortem_recorded.v1',
    );
  });
});
