import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  InternalToolExecutionContext,
  RuntimeRecordLearningBody,
} from '@nexus/core';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { WorkflowEngineService } from '../../workflow/workflow-engine.service';
import { EmbeddingWriteEnqueueService } from '../signals/embedding-write-enqueue.service';
import { MemoryContentScannerService } from '../memory-content-scanner.service';

const CANDIDATE_TYPE = 'runtime_learning';
const TITLE_MAX_LENGTH = 220;

type RecordLearningParams = Omit<
  RuntimeRecordLearningBody,
  'workflow_run_id' | 'job_id'
> & {
  provenance?: Record<string, unknown>;
};

interface RecordLearningOptions {
  candidateType?: string;
  sourceTool?: string;
  sourceQualityConfidence?: number;
  humanApprovedAt?: Date | null;
  signalsJsonExtra?: Record<string, unknown>;
}

const DEFAULT_SOURCE_TOOL = 'record_learning';

interface RecordLearningResult extends Record<string, unknown> {
  status: string;
  candidate_id: string;
  created: boolean;
  fingerprint: string;
}

@Injectable()
export class RecordLearningService {
  constructor(
    private readonly candidates: LearningCandidateRepository,
    private readonly eventLedger: EventLedgerService,
    private readonly workflowEngine: WorkflowEngineService,
    private readonly enqueue: EmbeddingWriteEnqueueService,
    private readonly scanner: MemoryContentScannerService,
  ) {}

  async recordLearning(
    context: InternalToolExecutionContext,
    params: RecordLearningParams,
    options?: RecordLearningOptions,
  ): Promise<RecordLearningResult> {
    this.scanner.scanContent(params.lesson);
    const scopeType = normalizeScopeType(params.scope_type);
    const scopeId = normalizeScopeId(scopeType, params.scope_id);
    const tags = normalizeTags(params.tags ?? []);
    const evidence = normalizeEvidence(params.evidence);
    const lesson = collapseWhitespace(params.lesson);
    const fingerprint = createFingerprint({
      scopeType,
      scopeId,
      lesson,
      evidence,
      tags,
    });

    const existing = await this.candidates.findByFingerprint(fingerprint);
    if (existing) {
      const reinforced = await this.reinforceExisting(existing);
      return toResult(reinforced, false);
    }

    const candidate = await this.createCandidateOrReadDuplicate({
      scopeType,
      scopeId,
      lesson,
      evidence,
      tags,
      confidence: params.confidence,
      fingerprint,
      context,
      provenance: params.provenance,
      options,
    });

    if (!candidate.created) {
      return toResult(candidate.candidate, false);
    }

    this.enqueue.enqueueOwner('learning_candidate', candidate.candidate.id);

    await this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.learningCandidateCreated,
      outcome: 'success',
      workflowRunId: context.workflowRunId,
      jobId: context.jobId,
      payload: {
        candidate_id: candidate.candidate.id,
        fingerprint: candidate.candidate.fingerprint,
        scope_type: scopeType,
        scope_id: scopeId,
        confidence: params.confidence,
        evidence_count: evidence.length,
        tag_count: tags.length,
      },
    });

    const pendingCount = await this.candidates.countByStatuses(['pending']);
    if (pendingCount >= 10) {
      this.workflowEngine
        .startWorkflow('memory_learning_sweep', {
          trigger: 'threshold',
          pendingCount,
        })
        .catch((_err: unknown) => {
          // Log or ignore errors so that recording learning is not interrupted
        });
    }

    return toResult(candidate.candidate, true);
  }

  private async createCandidateOrReadDuplicate(params: {
    scopeType: string;
    scopeId: string | null;
    lesson: string;
    evidence: Array<{ kind: string; id: string; summary: string }>;
    tags: string[];
    confidence: number;
    fingerprint: string;
    context: InternalToolExecutionContext;
    provenance?: Record<string, unknown>;
    options?: RecordLearningOptions;
  }): Promise<{ candidate: LearningCandidate; created: boolean }> {
    const candidateType = params.options?.candidateType ?? CANDIDATE_TYPE;
    const sourceTool = params.options?.sourceTool ?? DEFAULT_SOURCE_TOOL;
    const sourceQualityConfidence =
      params.options?.sourceQualityConfidence ?? 0;
    const humanApprovedAt = params.options?.humanApprovedAt ?? null;
    const signalsJsonExtra = params.options?.signalsJsonExtra ?? {};

    try {
      const candidate = await this.candidates.create({
        scope_type: params.scopeType,
        scopeId: params.scopeId,
        candidate_type: candidateType,
        title: deriveTitle(params.lesson),
        summary: params.lesson,
        fingerprint: params.fingerprint,
        signals_json: {
          lesson: params.lesson,
          evidence: params.evidence,
          tags: params.tags,
          confidence: params.confidence,
          provenance: buildProvenance(params.context, params.provenance),
          source: {
            tool: sourceTool,
            candidate_type: candidateType,
          },
          ...signalsJsonExtra,
        },
        score: params.confidence,
        confidence: params.confidence,
        source_quality_confidence: sourceQualityConfidence,
        human_approved_at: humanApprovedAt,
        status: 'pending',
        diagnostics_json: null,
      });

      return { candidate, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const existing = await this.candidates.findByFingerprint(
        params.fingerprint,
      );
      if (!existing) {
        throw error;
      }

      const reinforced = await this.reinforceExisting(existing);
      return { candidate: reinforced, created: false };
    }
  }

  /**
   * Reinforce an existing candidate when an exact-fingerprint duplicate is
   * recorded. The lesson recurring is itself signal: we advance
   * `last_seen_at` to now and bump `recurrence_count`. Phase-1's clusterer
   * later recomputes `recurrence_count`, so this increment is a safe interim
   * accrual. Applies to every caller (record_learning, remember, struggle).
   */
  private async reinforceExisting(
    existing: LearningCandidate,
  ): Promise<LearningCandidate> {
    const updated = await this.candidates.updateById(existing.id, {
      last_seen_at: new Date(),
      recurrence_count: existing.recurrence_count + 1,
    });

    return updated ?? existing;
  }
}

function toResult(
  candidate: LearningCandidate,
  created: boolean,
): RecordLearningResult {
  return {
    status: candidate.status,
    candidate_id: candidate.id,
    created,
    fingerprint: candidate.fingerprint,
  };
}

function buildProvenance(
  context: InternalToolExecutionContext,
  domainEvent: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    workflowRunId: context.workflowRunId,
    jobId: context.jobId,
    scopeId: context.scopeId ?? null,
    userId: context.userId,
    agentProfileName: context.agentProfileName,
    ...(domainEvent === undefined ? {} : { domainEvent }),
  };
}

function createFingerprint(parts: {
  scopeType: string;
  scopeId: string | null;
  lesson: string;
  evidence: Array<{ kind: string; id: string; summary: string }>;
  tags: string[];
}): string {
  const normalized = {
    scope_type: parts.scopeType,
    scope_id: parts.scopeId,
    lesson: parts.lesson.toLowerCase(),
    evidence: parts.evidence.map((item) => ({
      kind: item.kind.toLowerCase(),
      id: item.id.toLowerCase(),
      summary: item.summary.toLowerCase(),
    })),
    tags: parts.tags,
  };

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function normalizeEvidence(
  evidence: Array<{ kind: string; id: string; summary: string }>,
): Array<{ kind: string; id: string; summary: string }> {
  return evidence
    .map((item) => ({
      kind: collapseWhitespace(item.kind),
      id: collapseWhitespace(item.id),
      summary: collapseWhitespace(item.summary),
    }))
    .sort((left, right) => {
      const leftKey = evidenceSortKey(left);
      const rightKey = evidenceSortKey(right);
      return leftKey.localeCompare(rightKey);
    });
}

function evidenceSortKey(item: {
  kind: string;
  id: string;
  summary: string;
}): string {
  return [
    item.kind.toLowerCase(),
    item.id.toLowerCase(),
    item.summary.toLowerCase(),
  ].join('\u0000');
}

function deriveTitle(lesson: string): string {
  if (lesson.length <= TITLE_MAX_LENGTH) {
    return lesson;
  }

  return `${lesson.slice(0, TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

function normalizeScopeType(scopeType: string): string {
  return collapseWhitespace(scopeType).toLowerCase();
}

function normalizeScopeId(
  scopeType: string,
  scopeId: string | null | undefined,
): string | null {
  if (scopeType === 'global') {
    return null;
  }

  return scopeId ? collapseWhitespace(scopeId) : null;
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => collapseWhitespace(tag).toLowerCase()))]
    .filter((tag) => tag.length > 0)
    .sort();
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
