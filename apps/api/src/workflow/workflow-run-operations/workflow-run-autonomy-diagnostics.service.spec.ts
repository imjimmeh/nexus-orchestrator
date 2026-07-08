import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import type { EventLedgerService } from '../../observability/event-ledger.service';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import type { StateManagerService } from '../state-manager.service';
import { REPAIR_DELEGATION_STATE_KEY } from '../workflow-repair/repair-delegation.types';
import { WorkflowRunAutonomyDiagnosticsService } from './workflow-run-autonomy-diagnostics.service';

function ledgerEvent(overrides: Partial<EventLedger>): EventLedger {
  return {
    id: 'event-1',
    domain: 'workflow',
    event_name: AUTONOMY_EVENT_NAMES.failureClassificationDecided,
    outcome: 'success',
    severity: 'info',
    source: 'api',
    workflow_run_id: 'run-1',
    payload: {},
    occurred_at: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  };
}

function doctorRequestedEventFixture(
  overrides: Partial<EventLedger> = {},
): EventLedger {
  return ledgerEvent({
    id: 'doctor-requested-event',
    event_name: AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested,
    occurred_at: new Date('2026-04-01T00:01:00.000Z'),
    job_id: 'job-1',
    payload: {
      policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
      executionPath: 'doctor',
      attempt: 1,
    },
    ...overrides,
  });
}

function repairCompletedEventFixture(
  overrides: Partial<EventLedger> = {},
): EventLedger {
  return ledgerEvent({
    id: 'repair-completed-event',
    event_name: AUTONOMY_EVENT_NAMES.repairDelegationCompleted,
    outcome: 'success',
    occurred_at: new Date('2026-04-01T00:02:00.000Z'),
    job_id: 'job-1',
    error_message: 'Doctor repair completed.',
    payload: {
      status: 'succeeded',
      policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
      executionPath: 'doctor',
      attempt: 1,
      failedJobId: 'job-1',
      doctorRepairAttemptId: 'doctor-attempt-1',
    },
    ...overrides,
  });
}

function eventLedgerQueryResult(events: EventLedger[] = []) {
  return Promise.resolve({ events, total: events.length });
}

describe('WorkflowRunAutonomyDiagnosticsService', () => {
  const candidateId = '11111111-1111-4111-8111-111111111111';
  const groupId = '22222222-2222-4222-8222-222222222222';
  let eventLedger: Pick<EventLedgerService, 'query'>;
  let stateManager: Pick<StateManagerService, 'getVariable'>;
  let service: WorkflowRunAutonomyDiagnosticsService;

  beforeEach(() => {
    eventLedger = {
      query: vi.fn().mockResolvedValue({ events: [], total: 0 }),
    };
    stateManager = {
      getVariable: vi.fn().mockResolvedValue(null),
    };
    service = new WorkflowRunAutonomyDiagnosticsService(
      eventLedger as EventLedgerService,
      stateManager as StateManagerService,
    );
  });

  it('queries classification and repair delegation events for the workflow run', async () => {
    await service.getRunAutonomyDiagnostics('run-1');

    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'workflow',
        eventName: AUTONOMY_EVENT_NAMES.failureClassificationDecided,
        limit: 50,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'workflow',
        eventName: AUTONOMY_EVENT_NAMES.repairDelegationDecided,
        limit: 50,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'workflow',
        eventName: AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested,
        limit: 50,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'workflow',
        eventName: AUTONOMY_EVENT_NAMES.repairDelegationSysadminRequested,
        limit: 50,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'workflow',
        eventName: AUTONOMY_EVENT_NAMES.repairDelegationCompleted,
        limit: 50,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.runtimeFeedbackSignalIngested,
        limit: 50,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.runtimeFeedbackSignalSkipped,
        limit: 50,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.runtimeFeedbackCandidateCreated,
        limit: 50,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.learningRunStarted,
        limit: 50,
        offset: 0,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.learningRunCompleted,
        limit: 50,
        offset: 0,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.learningCandidateCreated,
        limit: 50,
        offset: 0,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.skillProposalCreated,
        limit: 50,
        offset: 0,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.skillProposalApproved,
        limit: 50,
        offset: 0,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.skillProposalRejected,
        limit: 50,
        offset: 0,
      }),
    );
    expect(eventLedger.query).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        domain: 'memory',
        eventName: AUTONOMY_EVENT_NAMES.skillProposalApprovalFailed,
        limit: 50,
        offset: 0,
      }),
    );
    expect(stateManager.getVariable).toHaveBeenCalledWith(
      'run-1',
      REPAIR_DELEGATION_STATE_KEY,
    );
  });

  it('returns an empty diagnostics list when no events or repair state exist', async () => {
    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics).toEqual({
      items: [],
      summary: {
        total: 0,
        byCategory: {
          failure_classification: 0,
          repair: 0,
          learning: 0,
          review: 0,
        },
      },
    });
  });

  it('projects classification and repair delegation events into sanitized summary items', async () => {
    const classificationEvent = ledgerEvent({
      id: 'classification-event',
      event_name: AUTONOMY_EVENT_NAMES.failureClassificationDecided,
      occurred_at: new Date('2026-04-01T00:00:00.000Z'),
      payload: {
        decision: {
          class: 'runtime_artifact_stale',
          confidence: 0.91,
          reason: 'Artifact browser-session-1 is stale.',
          eligibility: 'deny',
          allowedRepairActionIds: [],
          evidenceReferences: [
            {
              kind: 'runtime_diagnostic',
              id: 'diag-1',
              summary: 'Runtime artifact stale diagnostic.',
            },
          ],
        },
      },
    });
    const repairEvent = ledgerEvent({
      id: 'repair-event',
      event_name: AUTONOMY_EVENT_NAMES.repairDelegationDecided,
      occurred_at: new Date('2026-04-01T00:01:00.000Z'),
      job_id: 'job-1',
      payload: {
        status: 'dispatched',
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        executionPath: 'doctor',
        attempt: 1,
      },
    });
    vi.mocked(eventLedger.query).mockImplementation((query) => {
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.failureClassificationDecided
      ) {
        return eventLedgerQueryResult([classificationEvent]);
      }
      if (query.eventName === AUTONOMY_EVENT_NAMES.repairDelegationDecided) {
        return eventLedgerQueryResult([repairEvent]);
      }
      return eventLedgerQueryResult();
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        category: 'failure_classification',
        title: 'Failure classification: runtime_artifact_stale',
        status: 'denied',
        occurredAt: '2026-04-01T00:00:00.000Z',
        summary: expect.stringContaining(
          'Artifact browser-session-1 is stale.',
        ),
        evidence: [
          {
            kind: 'runtime_diagnostic',
            id: 'diag-1',
            summary: 'Runtime artifact stale diagnostic.',
          },
        ],
      }),
      expect.objectContaining({
        category: 'repair',
        title:
          'Repair delegation: doctor.runtime_artifact.refresh_stale_artifacts',
        status: 'in_progress',
        occurredAt: '2026-04-01T00:01:00.000Z',
        evidence: expect.arrayContaining([
          {
            kind: 'workflow_run',
            id: 'run-1',
            summary: 'Original workflow run.',
          },
          { kind: 'job_output', id: 'job-1', summary: 'Failed job output.' },
        ]),
      }),
    ]);
  });

  it('omits invalid classification evidence kinds and unsafe evidence ids', async () => {
    const classificationEvent = ledgerEvent({
      id: 'classification-event',
      event_name: AUTONOMY_EVENT_NAMES.failureClassificationDecided,
      occurred_at: new Date('2026-04-01T00:00:00.000Z'),
      payload: {
        decision: {
          class: 'runtime_artifact_stale',
          confidence: 0.91,
          reason: 'Artifact browser-session-1 is stale.',
          eligibility: 'deny',
          allowedRepairActionIds: [],
          evidenceReferences: [
            {
              kind: 'runtime_diagnostic',
              id: 'diag-1',
              summary: 'Runtime artifact stale diagnostic.',
            },
            {
              kind: 'not_a_valid_kind',
              id: 'invalid-1',
              summary: 'Invalid evidence kind.',
            },
            {
              kind: 'workflow_event',
              id: 'authorization=Bearer secret-token',
              summary: 'Valid kind with unsafe id.',
            },
            {
              kind: 'workflow_job',
              id: 'sk-live-tokenvalue789',
              summary: 'Valid kind with bare provider token id.',
            },
          ],
        },
      },
    });
    vi.mocked(eventLedger.query).mockImplementation((query) => {
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.failureClassificationDecided
      ) {
        return eventLedgerQueryResult([classificationEvent]);
      }
      return eventLedgerQueryResult();
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        category: 'failure_classification',
        evidence: [
          {
            kind: 'runtime_diagnostic',
            id: 'diag-1',
            summary: 'Runtime artifact stale diagnostic.',
          },
          {
            kind: 'workflow_event',
            summary: 'Valid kind with unsafe id.',
          },
          {
            kind: 'workflow_job',
            summary: 'Valid kind with bare provider token id.',
          },
        ],
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('not_a_valid_kind');
    expect(JSON.stringify(diagnostics)).not.toContain('authorization');
    expect(JSON.stringify(diagnostics)).not.toContain('secret-token');
    expect(JSON.stringify(diagnostics)).not.toContain('sk-live-tokenvalue789');
  });

  it('falls back for unsafe classification class values', async () => {
    const classificationEvent = ledgerEvent({
      id: 'classification-event',
      event_name: AUTONOMY_EVENT_NAMES.failureClassificationDecided,
      occurred_at: new Date('2026-04-01T00:00:00.000Z'),
      payload: {
        decision: {
          class: 'api_key=secret',
          confidence: 0.2,
          reason: 'Unable to classify safely.',
          eligibility: 'human_required',
          evidenceReferences: [],
        },
      },
    });
    vi.mocked(eventLedger.query).mockImplementation((query) => {
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.failureClassificationDecided
      ) {
        return eventLedgerQueryResult([classificationEvent]);
      }
      return eventLedgerQueryResult();
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        category: 'failure_classification',
        title: 'Failure classification: ambiguous_failure',
        summary: expect.stringContaining('Class: ambiguous_failure.'),
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('api_key=secret');
  });

  it('projects runtime feedback events into sanitized autonomy summary items', async () => {
    const candidateEvent = ledgerEvent({
      id: 'candidate-event',
      domain: 'memory',
      event_name: AUTONOMY_EVENT_NAMES.runtimeFeedbackCandidateCreated,
      occurred_at: new Date('2026-04-01T00:02:00.000Z'),
      job_id: 'job-1',
      payload: {
        group_id: groupId,
        candidate_id: candidateId,
        signal_type: 'tool_contract_repair',
        dedupe_fingerprint_hash: 'a'.repeat(64),
        evidence: [{ summary: 'raw job output: should not appear' }],
      },
    });
    const skippedEvent = ledgerEvent({
      id: 'skipped-event',
      domain: 'memory',
      event_name: AUTONOMY_EVENT_NAMES.runtimeFeedbackSignalSkipped,
      occurred_at: new Date('2026-04-01T00:03:00.000Z'),
      payload: {
        group_id: 'group-2',
        signal_type: 'raw job output api_key=secret-value',
        skipped_reason: 'confidence_below_threshold',
        diagnostics: { bearer: 'token' },
      },
    });
    vi.mocked(eventLedger.query).mockImplementation((query) => {
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.runtimeFeedbackCandidateCreated
      ) {
        return eventLedgerQueryResult([candidateEvent]);
      }
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.runtimeFeedbackSignalSkipped
      ) {
        return eventLedgerQueryResult([skippedEvent]);
      }
      return eventLedgerQueryResult();
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        category: 'learning',
        title: 'Runtime feedback: tool_contract_repair',
        status: 'needs_review',
        occurredAt: '2026-04-01T00:02:00.000Z',
        evidence: expect.arrayContaining([
          {
            kind: 'workflow_run',
            id: 'run-1',
            summary: 'Workflow run associated with runtime feedback.',
          },
          {
            kind: 'event_ledger',
            id: 'candidate-event',
            summary: 'Runtime feedback event ledger record.',
          },
          {
            kind: 'workflow_job',
            id: 'job-1',
            summary: 'Job associated with runtime feedback.',
          },
          {
            kind: 'learning_candidate',
            id: candidateId,
            summary: 'Runtime feedback learning candidate.',
          },
          {
            kind: 'runtime_diagnostic',
            id: groupId,
            summary: 'Runtime feedback signal group.',
          },
        ]),
      }),
      expect.objectContaining({
        category: 'learning',
        title: 'Runtime feedback: [REDACTED]',
        status: 'denied',
        occurredAt: '2026-04-01T00:03:00.000Z',
        summary:
          'Runtime feedback signal skipped. Reason: confidence_below_threshold.',
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('secret-value');
    expect(JSON.stringify(diagnostics)).not.toContain('raw job output');
    expect(JSON.stringify(diagnostics)).not.toContain('bearer');
  });

  it('summarizes diagnostic totals by category and latest status', async () => {
    const classificationEvent = ledgerEvent({
      id: 'classification-event',
      event_name: AUTONOMY_EVENT_NAMES.failureClassificationDecided,
      occurred_at: new Date('2026-04-01T00:00:00.000Z'),
      payload: {
        decision: {
          class: 'runtime_artifact_stale',
          confidence: 0.91,
          reason: 'Artifact browser-session-1 is stale.',
          eligibility: 'deny',
          evidenceReferences: [],
        },
      },
    });
    const repairEvent = ledgerEvent({
      id: 'repair-event',
      event_name: AUTONOMY_EVENT_NAMES.repairDelegationDecided,
      occurred_at: new Date('2026-04-01T00:01:00.000Z'),
      payload: {
        status: 'dispatched',
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        executionPath: 'doctor',
        attempt: 1,
      },
    });
    const learningEvent = ledgerEvent({
      id: 'learning-event',
      domain: 'memory',
      event_name: AUTONOMY_EVENT_NAMES.runtimeFeedbackCandidateCreated,
      occurred_at: new Date('2026-04-01T00:02:00.000Z'),
      payload: {
        group_id: groupId,
        candidate_id: candidateId,
        signal_type: 'tool_contract_repair',
      },
    });
    vi.mocked(eventLedger.query).mockImplementation((query) => {
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.failureClassificationDecided
      ) {
        return eventLedgerQueryResult([classificationEvent]);
      }
      if (query.eventName === AUTONOMY_EVENT_NAMES.repairDelegationDecided) {
        return eventLedgerQueryResult([repairEvent]);
      }
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.runtimeFeedbackCandidateCreated
      ) {
        return eventLedgerQueryResult([learningEvent]);
      }
      return eventLedgerQueryResult();
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.summary).toEqual({
      total: 3,
      byCategory: {
        failure_classification: 1,
        repair: 1,
        learning: 1,
        review: 0,
      },
      latestStatus: 'needs_review',
    });
  });

  it('projects requested and completed repair events in chronological order', async () => {
    const requestedEvent = doctorRequestedEventFixture();
    const completedEvent = repairCompletedEventFixture();
    vi.mocked(eventLedger.query).mockImplementation((query) => {
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested
      ) {
        return eventLedgerQueryResult([requestedEvent]);
      }
      if (query.eventName === AUTONOMY_EVENT_NAMES.repairDelegationCompleted) {
        return eventLedgerQueryResult([completedEvent]);
      }
      return eventLedgerQueryResult();
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        category: 'repair',
        title:
          'Repair delegation: doctor.runtime_artifact.refresh_stale_artifacts',
        status: 'in_progress',
        occurredAt: '2026-04-01T00:01:00.000Z',
        summary: expect.stringContaining('Doctor repair requested.'),
        evidence: expect.arrayContaining([
          {
            kind: 'workflow_run',
            id: 'run-1',
            summary: 'Original workflow run.',
          },
          { kind: 'job_output', id: 'job-1', summary: 'Failed job output.' },
        ]),
      }),
      expect.objectContaining({
        category: 'repair',
        title:
          'Repair delegation: doctor.runtime_artifact.refresh_stale_artifacts',
        status: 'succeeded',
        occurredAt: '2026-04-01T00:02:00.000Z',
        summary: expect.stringContaining('Doctor repair completed.'),
        evidence: expect.arrayContaining([
          {
            kind: 'workflow_run',
            id: 'run-1',
            summary: 'Original workflow run.',
          },
          { kind: 'job_output', id: 'job-1', summary: 'Failed job output.' },
          {
            kind: 'doctor_repair_history',
            id: 'doctor-attempt-1',
            summary: 'Doctor repair attempt history.',
          },
        ]),
      }),
    ]);
  });

  it('projects learning lifecycle and proposal events in chronological order with repairs', async () => {
    const learningCompleted = ledgerEvent({
      id: 'learning-completed',
      domain: 'memory',
      event_name: AUTONOMY_EVENT_NAMES.learningRunCompleted,
      occurred_at: new Date('2026-04-01T00:04:00.000Z'),
      payload: {
        runId: 'learning-run-1',
        trigger: 'manual',
        scannedScopes: 1,
        rankedCandidates: 1,
        promotedCandidates: 0,
        createdSkillProposals: 1,
      },
    });
    const learningCandidate = ledgerEvent({
      id: 'learning-candidate',
      domain: 'memory',
      event_name: AUTONOMY_EVENT_NAMES.learningCandidateCreated,
      occurred_at: new Date('2026-04-01T00:02:00.000Z'),
      job_id: 'job-1',
      payload: {
        candidate_id: candidateId,
        scope_type: 'workflow_run',
        scope_id: 'run-1',
        confidence: 0.72,
        evidence_count: 2,
        tag_count: 1,
      },
    });
    const repairRequested = ledgerEvent({
      id: 'repair-requested',
      event_name: AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested,
      occurred_at: new Date('2026-04-01T00:01:00.000Z'),
      job_id: 'job-1',
      payload: {
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        executionPath: 'doctor',
        attempt: 1,
      },
    });
    const proposalApproved = ledgerEvent({
      id: 'proposal-approved',
      domain: 'memory',
      event_name: AUTONOMY_EVENT_NAMES.skillProposalApproved,
      occurred_at: new Date('2026-04-01T00:03:00.000Z'),
      payload: {
        proposalId: 'proposal-1',
        status: 'approved',
        title: 'Improve repair diagnostics',
        diagnostics: {
          source_evidence: {
            learning_candidate_id: candidateId,
            source_evidence: [
              {
                sourceType: 'retrospective',
                workflowRunId: 'run-1',
                eventCount: 3,
                raw_payload: 'raw job output api_key=secret must not appear',
              },
            ],
          },
        },
      },
    });
    vi.mocked(eventLedger.query).mockImplementation((query) => {
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested
      ) {
        return eventLedgerQueryResult([repairRequested]);
      }
      if (query.eventName === AUTONOMY_EVENT_NAMES.learningRunCompleted) {
        return eventLedgerQueryResult([learningCompleted]);
      }
      if (query.eventName === AUTONOMY_EVENT_NAMES.learningCandidateCreated) {
        return eventLedgerQueryResult([learningCandidate]);
      }
      if (query.eventName === AUTONOMY_EVENT_NAMES.skillProposalApproved) {
        return eventLedgerQueryResult([proposalApproved]);
      }
      return eventLedgerQueryResult();
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items.map((item) => item.occurredAt)).toEqual([
      '2026-04-01T00:01:00.000Z',
      '2026-04-01T00:02:00.000Z',
      '2026-04-01T00:03:00.000Z',
      '2026-04-01T00:04:00.000Z',
    ]);
    expect(diagnostics.items).toEqual([
      expect.objectContaining({ category: 'repair', status: 'in_progress' }),
      expect.objectContaining({
        category: 'learning',
        title: 'Learning candidate created',
        status: 'needs_review',
      }),
      expect.objectContaining({
        category: 'learning',
        title: expect.stringContaining('Improve repair diagnostics'),
        status: 'succeeded',
        evidence: expect.arrayContaining([
          {
            kind: 'workflow_run',
            id: 'run-1',
            summary: 'retrospective source evidence with 3 events.',
          },
        ]),
      }),
      expect.objectContaining({
        category: 'learning',
        title: expect.stringContaining('Learning run'),
        status: 'succeeded',
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('api_key=secret');
    expect(JSON.stringify(diagnostics)).not.toContain('raw job output');
  });

  it('uses requested repair payload execution path before event-name inference', async () => {
    const requestedEvent = ledgerEvent({
      id: 'requested-event',
      event_name: AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested,
      occurred_at: new Date('2026-04-01T00:01:00.000Z'),
      job_id: 'job-1',
      payload: {
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        executionPath: 'sysadmin_workflow',
        attempt: 1,
      },
    });
    vi.mocked(eventLedger.query).mockImplementation((query) => {
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.repairDelegationDoctorRequested
      ) {
        return eventLedgerQueryResult([requestedEvent]);
      }
      return eventLedgerQueryResult();
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        category: 'repair',
        status: 'in_progress',
        summary: expect.stringContaining('Execution path: sysadmin_workflow'),
      }),
    ]);
  });

  it('redacts classification reason and repair event error messages with raw output labels', async () => {
    const classificationEvent = ledgerEvent({
      id: 'classification-event',
      event_name: AUTONOMY_EVENT_NAMES.failureClassificationDecided,
      occurred_at: new Date('2026-04-01T00:00:00.000Z'),
      payload: {
        decision: {
          class: 'ambiguous_failure',
          confidence: 0.2,
          reason: 'full transcript: unrestricted conversation follows',
          eligibility: 'deny',
          allowedRepairActionIds: [],
          evidenceReferences: [],
        },
      },
    });
    const repairEvent = ledgerEvent({
      id: 'repair-event',
      event_name: AUTONOMY_EVENT_NAMES.repairDelegationDecided,
      occurred_at: new Date('2026-04-01T00:01:00.000Z'),
      error_message: 'job output: unrestricted command output follows',
      payload: {
        status: 'failed',
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        executionPath: 'doctor',
        attempt: 1,
      },
    });
    vi.mocked(eventLedger.query).mockImplementation((query) => {
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.failureClassificationDecided
      ) {
        return eventLedgerQueryResult([classificationEvent]);
      }
      if (query.eventName === AUTONOMY_EVENT_NAMES.repairDelegationDecided) {
        return eventLedgerQueryResult([repairEvent]);
      }
      return eventLedgerQueryResult();
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        category: 'failure_classification',
        summary: '[REDACTED]',
      }),
      expect.objectContaining({
        category: 'repair',
        summary: '[REDACTED]',
      }),
    ]);
  });

  it('redacts secret-bearing classification reasons and repair messages', async () => {
    const classificationEvent = ledgerEvent({
      id: 'classification-event',
      event_name: AUTONOMY_EVENT_NAMES.failureClassificationDecided,
      occurred_at: new Date('2026-04-01T00:00:00.000Z'),
      payload: {
        decision: {
          class: 'credential_missing',
          confidence: 0.9,
          reason:
            'credential and bearer values were included in diagnostic summary',
          eligibility: 'deny',
          allowedRepairActionIds: [],
          evidenceReferences: [],
        },
      },
    });
    const repairEvent = ledgerEvent({
      id: 'repair-event',
      event_name: AUTONOMY_EVENT_NAMES.repairDelegationDecided,
      occurred_at: new Date('2026-04-01T00:01:00.000Z'),
      error_message:
        'api-key and access-token appeared in repair output summary',
      payload: {
        status: 'failed',
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        executionPath: 'doctor',
        attempt: 1,
      },
    });
    vi.mocked(stateManager.getVariable).mockResolvedValue({
      attempts: { 'doctor.runtime_artifact.refresh_stale_artifacts': 1 },
      latest: {
        status: 'failed',
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        executionPath: 'doctor',
        attempt: 1,
        message: 'password and authorization appeared in latest repair state',
        recordedAt: '2026-04-01T00:02:00.000Z',
      },
    });
    vi.mocked(eventLedger.query).mockImplementation((query) => {
      if (
        query.eventName === AUTONOMY_EVENT_NAMES.failureClassificationDecided
      ) {
        return eventLedgerQueryResult([classificationEvent]);
      }
      if (query.eventName === AUTONOMY_EVENT_NAMES.repairDelegationDecided) {
        return eventLedgerQueryResult([repairEvent]);
      }
      return eventLedgerQueryResult();
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        category: 'failure_classification',
        summary: '[REDACTED]',
      }),
      expect.objectContaining({
        category: 'repair',
        occurredAt: '2026-04-01T00:01:00.000Z',
        summary: '[REDACTED]',
      }),
      expect.objectContaining({
        category: 'repair',
        occurredAt: '2026-04-01T00:02:00.000Z',
        summary: '[REDACTED]',
      }),
    ]);
  });

  it('includes the latest repair delegation state when present', async () => {
    vi.mocked(stateManager.getVariable).mockResolvedValue({
      attempts: { 'doctor.runtime_artifact.refresh_stale_artifacts': 2 },
      latest: {
        status: 'failed',
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        executionPath: 'doctor',
        attempt: 2,
        failedJobId: 'job-2',
        doctorRepairAttemptId: 'doctor-attempt-2',
        message: 'Doctor repair failed without exposing raw output.',
        recordedAt: '2026-04-01T00:02:00.000Z',
      },
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        category: 'repair',
        status: 'failed',
        occurredAt: '2026-04-01T00:02:00.000Z',
        summary: expect.stringContaining('Doctor repair failed'),
        evidence: expect.arrayContaining([
          {
            kind: 'workflow_run',
            id: 'run-1',
            summary: 'Original workflow run.',
          },
          { kind: 'job_output', id: 'job-2', summary: 'Failed job output.' },
          {
            kind: 'doctor_repair_history',
            id: 'doctor-attempt-2',
            summary: 'Doctor repair attempt history.',
          },
        ]),
        nextSteps: [
          {
            label: 'Inspect repair output and retry manually if safe',
            severity: 'error',
          },
        ],
      }),
    ]);
  });

  it('projects malformed latest repair state with safe defaults', async () => {
    vi.mocked(stateManager.getVariable).mockResolvedValue({
      attempts: {},
      latest: {
        status: 'api_key=secret',
        policyActionId: 123,
        executionPath: 'invalid-path',
        attempt: 'not-a-number',
        failedJobId: 'authorization bearer token',
        doctorRepairAttemptId: 'doctor-attempt-1',
        repairWorkflowRunId: 'raw job output leaked',
        message: 42,
        recordedAt: 123,
      },
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        category: 'repair',
        title: 'Repair delegation: unknown',
        status: 'failed',
        occurredAt: undefined,
        summary: 'Policy action: unknown. Execution path: doctor. Attempt: 0',
        evidence: [
          {
            kind: 'workflow_run',
            id: 'run-1',
            summary: 'Original workflow run.',
          },
          { kind: 'job_output', summary: 'Failed job output.' },
          {
            kind: 'doctor_repair_history',
            id: 'doctor-attempt-1',
            summary: 'Doctor repair attempt history.',
          },
          { kind: 'workflow_run', summary: 'Repair workflow run.' },
        ],
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('api_key=secret');
    expect(JSON.stringify(diagnostics)).not.toContain('authorization');
    expect(JSON.stringify(diagnostics)).not.toContain('raw job output');
    expect(JSON.stringify(diagnostics)).not.toContain('invalid-path');
    expect(JSON.stringify(diagnostics)).not.toContain('not-a-number');
  });

  it('redacts latest repair state messages with transcript body labels', async () => {
    vi.mocked(stateManager.getVariable).mockResolvedValue({
      attempts: { 'doctor.runtime_artifact.refresh_stale_artifacts': 1 },
      latest: {
        status: 'failed',
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        executionPath: 'doctor',
        attempt: 1,
        message: 'transcript body: unrestricted agent transcript follows',
        recordedAt: '2026-04-01T00:02:00.000Z',
      },
    });

    const diagnostics = await service.getRunAutonomyDiagnostics('run-1');

    expect(diagnostics.items).toEqual([
      expect.objectContaining({
        category: 'repair',
        summary: '[REDACTED]',
      }),
    ]);
  });
});
