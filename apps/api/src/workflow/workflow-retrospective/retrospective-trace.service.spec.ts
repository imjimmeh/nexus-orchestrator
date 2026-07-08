import { describe, expect, it, vi } from 'vitest';
import type { EventLedgerService } from '../../observability/event-ledger.service';
import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import { RetrospectiveTraceService } from './retrospective-trace.service';

describe('RetrospectiveTraceService', () => {
  it('summarizes retrospective finding lifecycle events for a run', async () => {
    const eventLedger = {
      query: vi.fn().mockResolvedValue({
        total: 3,
        events: [
          ledgerEvent({
            id: 'evt-1',
            event_name: 'retrospective.finding.received',
            payload: {
              finding_index: 0,
              original_run_id: 'original-run-1',
            },
          }),
          ledgerEvent({
            id: 'evt-2',
            event_name: 'retrospective.finding.routed',
            payload: {
              finding_index: 0,
              original_run_id: 'original-run-1',
              terminal_outcome: 'routed',
              candidate_id: 'candidate-1',
            },
          }),
          ledgerEvent({
            id: 'evt-3',
            event_name: 'retrospective.finding.rejected',
            payload: {
              finding_index: 1,
              original_run_id: 'original-run-1',
              terminal_outcome: 'rejected_schema',
              reason_code: 'schema_invalid',
            },
          }),
        ],
      }),
    };
    const service = new RetrospectiveTraceService(
      eventLedger as unknown as EventLedgerService,
    );

    const result = await service.getTrace('analyst-run-1');

    expect(eventLedger.query).toHaveBeenCalledWith({
      domain: 'workflow',
      workflowRunId: 'analyst-run-1',
      search: 'retrospective.finding',
      limit: 500,
      sortBy: 'occurred_at',
      sortDir: 'asc',
    });
    expect(result).toEqual({
      workflowRunId: 'analyst-run-1',
      findingsTotal: 2,
      outcomes: {
        rejected_schema: 1,
        routed: 1,
      },
      findings: [
        {
          index: 0,
          originalRunId: 'original-run-1',
          outcome: 'routed',
          candidateId: 'candidate-1',
          reasonCode: null,
          skillProposalId: null,
        },
        {
          index: 1,
          originalRunId: 'original-run-1',
          outcome: 'rejected_schema',
          candidateId: null,
          reasonCode: 'schema_invalid',
          skillProposalId: null,
        },
      ],
    });
  });
});

function ledgerEvent(overrides: Partial<EventLedger>): EventLedger {
  return {
    id: 'evt',
    domain: 'workflow',
    event_name: 'retrospective.finding.received',
    outcome: 'success',
    severity: 'info',
    source: 'api',
    workflow_run_id: 'analyst-run-1',
    payload: {},
    occurred_at: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}
