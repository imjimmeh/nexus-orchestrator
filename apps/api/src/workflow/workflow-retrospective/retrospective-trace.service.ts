import { Injectable } from '@nestjs/common';
import { EventLedgerService } from '../../observability/event-ledger.service';
import type { EventLedger } from '../../runtime/database/entities/event-ledger.entity';
import type {
  RetrospectiveFindingTraceItem,
  RetrospectiveTrace,
} from './retrospective-trace.types';

const RETROSPECTIVE_FINDING_EVENT_SEARCH = 'retrospective.finding';
const RETROSPECTIVE_TRACE_LIMIT = 500;

@Injectable()
export class RetrospectiveTraceService {
  constructor(private readonly eventLedger: EventLedgerService) {}

  async getTrace(workflowRunId: string): Promise<RetrospectiveTrace> {
    const { events } = await this.eventLedger.query({
      domain: 'workflow',
      workflowRunId,
      search: RETROSPECTIVE_FINDING_EVENT_SEARCH,
      limit: RETROSPECTIVE_TRACE_LIMIT,
      sortBy: 'occurred_at',
      sortDir: 'asc',
    });
    const findings = this.buildFindingItems(events);
    const outcomes = this.countOutcomes(findings);

    return {
      workflowRunId,
      findingsTotal: findings.length,
      outcomes,
      findings,
    };
  }

  private buildFindingItems(
    events: EventLedger[],
  ): RetrospectiveFindingTraceItem[] {
    const findingsByIndex = new Map<number, RetrospectiveFindingTraceItem>();

    for (const event of events) {
      const payload = event.payload ?? {};
      const index = this.numberField(payload, 'finding_index');
      if (index === null) {
        continue;
      }

      const existing =
        findingsByIndex.get(index) ?? this.createFindingTraceItem(index);
      existing.originalRunId =
        this.stringField(payload, 'original_run_id') ?? existing.originalRunId;
      existing.outcome =
        this.stringField(payload, 'terminal_outcome') ?? existing.outcome;
      existing.reasonCode =
        this.stringField(payload, 'reason_code') ?? existing.reasonCode;
      existing.candidateId =
        this.stringField(payload, 'candidate_id') ?? existing.candidateId;
      existing.skillProposalId =
        this.stringField(payload, 'skill_proposal_id') ??
        existing.skillProposalId;
      findingsByIndex.set(index, existing);
    }

    return [...findingsByIndex.values()].sort(
      (left, right) => left.index - right.index,
    );
  }

  private createFindingTraceItem(index: number): RetrospectiveFindingTraceItem {
    return {
      index,
      originalRunId: null,
      outcome: null,
      reasonCode: null,
      candidateId: null,
      skillProposalId: null,
    };
  }

  private countOutcomes(
    findings: RetrospectiveFindingTraceItem[],
  ): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const finding of findings) {
      if (!finding.outcome) {
        continue;
      }

      counts[finding.outcome] = (counts[finding.outcome] ?? 0) + 1;
    }

    return counts;
  }

  private numberField(
    payload: Record<string, unknown>,
    field: string,
  ): number | null {
    const value = payload[field];
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
  }

  private stringField(
    payload: Record<string, unknown>,
    field: string,
  ): string | null {
    const value = payload[field];
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }
}
