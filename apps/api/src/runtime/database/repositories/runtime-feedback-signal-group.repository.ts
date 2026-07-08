import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { RuntimeFeedbackSignalGroup } from '../entities/runtime-feedback-signal-group.entity';

const SEVERITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

interface IncrementOccurrenceParams {
  evidence: Array<Record<string, unknown>>;
  examples: Array<Record<string, unknown>>;
  confidence: number;
  severity: string;
  lastSeenAt: Date;
  maxEvidenceItems: number;
  maxExampleItems: number;
}

interface RuntimeFeedbackGroupFilters {
  signalType?: string;
  candidateCreated?: boolean;
}

interface ListFeedbackGroupsParams extends RuntimeFeedbackGroupFilters {
  limit: number;
  offset: number;
}

interface RuntimeFeedbackDiagnosticCounts {
  signalCounts: Array<{ signalType: string; count: number }>;
  candidateCounts: Array<{ candidateCreated: boolean; count: number }>;
  skippedReasonCounts: Array<{ reason: string; count: number }>;
}

@Injectable()
export class RuntimeFeedbackSignalGroupRepository {
  constructor(
    @InjectRepository(RuntimeFeedbackSignalGroup)
    private readonly repository: Repository<RuntimeFeedbackSignalGroup>,
  ) {}

  findByFingerprint(
    dedupe_fingerprint: string,
  ): Promise<RuntimeFeedbackSignalGroup | null> {
    return this.repository.findOne({ where: { dedupe_fingerprint } });
  }

  /**
   * Find the id of the most recent runtime-feedback signal group for a
   * given learning candidate, used by the self-improvement control
   * plane `PromotedLessonsCard` to surface the source signal that
   * drove a promoted lesson. Ordering: `last_seen_at DESC` (freshest
   * signal wins), ties broken by `max_confidence DESC` (a stronger
   * correlated signal is the more useful pointer for an operator).
   *
   * Returns `null` when no signal group has been correlated with the
   * candidate (the runtime-feedback pipeline records the linkage via
   * the entity's `candidate_id` column — see
   * `runtime_feedback_signal_groups.candidate_id` in
   * `apps/api/src/database/migrations/...`).
   */
  findMostRecentIdByCandidateId(candidateId: string): Promise<string | null> {
    return this.repository
      .createQueryBuilder('feedback_group')
      .select('feedback_group.id', 'id')
      .where('feedback_group.candidate_id = :candidateId', { candidateId })
      .orderBy('feedback_group.last_seen_at', 'DESC')
      .addOrderBy('feedback_group.max_confidence', 'DESC')
      .limit(1)
      .getRawOne<{ id: string }>()
      .then((row) => row?.id ?? null);
  }

  /**
   * Finds the active (unresolved — no learning candidate) failure-classification
   * signal group for a given failure class and workflow definition id, ordered
   * by recurrence. Used by the delegation circuit breaker to detect a workflow
   * that keeps failing the same human-required way. The failure fingerprint is
   * `failure_classification|<class>|workflow:<workflowId>|eligibility:…|repair_action:…`
   * (see WorkflowFailureClassificationService), so a prefix match is stable
   * across eligibility/repair-action variation.
   */
  findActiveFailureClassificationGroup(params: {
    failureClass: string;
    workflowId: string;
  }): Promise<RuntimeFeedbackSignalGroup | null> {
    return this.repository
      .createQueryBuilder('g')
      .where('g.signal_type = :signalType', {
        signalType: 'failure_classification',
      })
      .andWhere('g.candidate_id IS NULL')
      .andWhere('g.dedupe_fingerprint LIKE :prefix', {
        prefix: `failure_classification|${params.failureClass}|workflow:${params.workflowId}|%`,
      })
      .orderBy('g.window_occurrence_count', 'DESC')
      .getOne();
  }

  async createGroup(
    data: Partial<RuntimeFeedbackSignalGroup>,
  ): Promise<RuntimeFeedbackSignalGroup> {
    return this.repository.save(this.repository.create(data));
  }

  async updateGroup(
    id: string,
    data: Partial<RuntimeFeedbackSignalGroup>,
  ): Promise<RuntimeFeedbackSignalGroup | null> {
    await this.repository.update(
      { id },
      data as Parameters<typeof this.repository.update>[1],
    );
    return this.repository.findOne({ where: { id } });
  }

  async incrementOccurrence(
    id: string,
    data: IncrementOccurrenceParams,
  ): Promise<RuntimeFeedbackSignalGroup | null> {
    await this.repository
      .createQueryBuilder()
      .update(RuntimeFeedbackSignalGroup)
      .set({
        occurrence_count: () => 'occurrence_count + 1',
        window_occurrence_count: () => 'window_occurrence_count + 1',
        evidence_json: () => limitedJsonbAppendExpression('evidence_json'),
        examples_json: () => limitedJsonbAppendExpression('examples_json'),
        max_confidence: () => 'GREATEST(max_confidence, :confidence)',
        max_severity: () =>
          `CASE WHEN ${severityRankExpression('max_severity')} < :severityRank THEN :severity ELSE max_severity END`,
        last_seen_at: data.lastSeenAt,
      } satisfies QueryDeepPartialEntity<RuntimeFeedbackSignalGroup>)
      .where('id = :id', { id })
      .setParameters({
        confidence: data.confidence,
        evidenceJson: JSON.stringify(data.evidence),
        evidenceLimit: data.maxEvidenceItems,
        examplesJson: JSON.stringify(data.examples),
        exampleLimit: data.maxExampleItems,
        severity: data.severity,
        severityRank: SEVERITY_RANK[data.severity] ?? 0,
      })
      .execute();

    return this.repository.findOne({ where: { id } });
  }

  async updateSkippedMetadataIfCandidateMissing(
    id: string,
    data: Pick<
      Partial<RuntimeFeedbackSignalGroup>,
      | 'diagnostics_json'
      | 'last_skipped_reason'
      | 'window_occurrence_count'
      | 'window_started_at'
    >,
  ): Promise<RuntimeFeedbackSignalGroup | null> {
    await this.repository.update(
      { id, candidateId: IsNull() },
      data as Parameters<typeof this.repository.update>[1],
    );
    return this.repository.findOne({ where: { id } });
  }

  async listDiagnostics(
    params: ListFeedbackGroupsParams,
  ): Promise<{ data: RuntimeFeedbackSignalGroup[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('feedback_group')
      .orderBy('feedback_group.last_seen_at', 'DESC')
      .offset(params.offset)
      .limit(params.limit);

    this.applyDiagnosticFilters(qb, params);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async listDiagnosticCounts(
    params: RuntimeFeedbackGroupFilters,
  ): Promise<RuntimeFeedbackDiagnosticCounts> {
    const signalQb = this.repository
      .createQueryBuilder('feedback_group')
      .select('feedback_group.signal_type', 'signalType')
      .addSelect('SUM(feedback_group.occurrence_count)', 'count')
      .groupBy('feedback_group.signal_type')
      .orderBy('count', 'DESC');
    this.applyDiagnosticFilters(signalQb, params);

    const candidateQb = this.repository
      .createQueryBuilder('feedback_group')
      .select('feedback_group.candidate_id IS NOT NULL', 'candidateCreated')
      .addSelect('COUNT(*)', 'count')
      .groupBy('feedback_group.candidate_id IS NOT NULL')
      .orderBy('count', 'DESC');
    this.applyDiagnosticFilters(candidateQb, params);

    const skippedQb = this.repository
      .createQueryBuilder('feedback_group')
      .select('feedback_group.last_skipped_reason', 'reason')
      .addSelect('COUNT(*)', 'count')
      .andWhere('feedback_group.last_skipped_reason IS NOT NULL')
      .groupBy('feedback_group.last_skipped_reason')
      .orderBy('count', 'DESC');
    this.applyDiagnosticFilters(skippedQb, params);

    const [signalRows, candidateRows, skippedRows] = await Promise.all([
      signalQb.getRawMany<{ signalType: string; count: string | number }>(),
      candidateQb.getRawMany<{
        candidateCreated: boolean | string;
        count: string | number;
      }>(),
      skippedQb.getRawMany<{ reason: string; count: string | number }>(),
    ]);

    return {
      signalCounts: signalRows.map((row) => ({
        signalType: row.signalType,
        count: Number(row.count),
      })),
      candidateCounts: candidateRows.map((row) => ({
        candidateCreated: this.toBoolean(row.candidateCreated),
        count: Number(row.count),
      })),
      skippedReasonCounts: skippedRows.map((row) => ({
        reason: row.reason,
        count: Number(row.count),
      })),
    };
  }

  private applyDiagnosticFilters(
    qb: SelectQueryBuilder<RuntimeFeedbackSignalGroup>,
    params: RuntimeFeedbackGroupFilters,
  ): void {
    if (params.signalType) {
      qb.andWhere('feedback_group.signal_type = :signalType', {
        signalType: params.signalType,
      });
    }

    if (params.candidateCreated === true) {
      qb.andWhere('feedback_group.candidate_id IS NOT NULL');
    }

    if (params.candidateCreated === false) {
      qb.andWhere('feedback_group.candidate_id IS NULL');
    }
  }

  private toBoolean(value: boolean | string): boolean {
    return value === true || value === 'true';
  }
}

function limitedJsonbAppendExpression(columnName: string): string {
  const jsonParam =
    columnName === 'evidence_json' ? 'evidenceJson' : 'examplesJson';
  const limitParam =
    columnName === 'evidence_json' ? 'evidenceLimit' : 'exampleLimit';

  return `(SELECT COALESCE(jsonb_agg(value ORDER BY ordinal), '[]'::jsonb) FROM (SELECT value, ordinal FROM jsonb_array_elements(COALESCE(${columnName}, '[]'::jsonb) || :${jsonParam}::jsonb) WITH ORDINALITY AS items(value, ordinal) ORDER BY ordinal DESC LIMIT :${limitParam}) limited_items)`;
}

function severityRankExpression(columnName: string): string {
  return `CASE ${columnName} WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 ELSE 0 END`;
}
