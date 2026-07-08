import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  runtimeFeedbackSignalSchema,
  type RuntimeFeedbackSignal,
} from '@nexus/core';
import { createHash } from 'node:crypto';
import type { LearningCandidate } from '../memory/database/entities/learning-candidate.entity';
import type { RuntimeFeedbackSignalGroup } from '../runtime/database/entities/runtime-feedback-signal-group.entity';
import { LearningCandidateRepository } from '../memory/database/repositories/learning-candidate.repository';
import { RuntimeFeedbackSignalGroupRepository } from '../runtime/database/repositories/runtime-feedback-signal-group.repository';
import { EventLedgerService } from '../observability/event-ledger.service';
import { RuntimeFeedbackPolicyService } from './runtime-feedback-policy.service';
import { RuntimeFeedbackRedactionService } from './runtime-feedback-redaction.service';
import {
  RUNTIME_FEEDBACK_CANDIDATE_TYPE,
  RUNTIME_FEEDBACK_EVENT_NAMES,
  type RuntimeFeedbackSkippedReason,
} from './runtime-feedback.types';

const MAX_EVIDENCE_ITEMS = 20;
const MAX_EXAMPLE_ITEMS = 10;

type RuntimeFeedbackEvidence = RuntimeFeedbackSignal['evidence'][number];
type RuntimeFeedbackExample = RuntimeFeedbackSignal['examples'][number];

interface RuntimeFeedbackIngestionResult {
  groupId: string;
  candidateId: string | null;
  promoted: boolean;
  skippedReason: RuntimeFeedbackSkippedReason | null;
}

@Injectable()
export class RuntimeFeedbackIngestionService {
  constructor(
    private readonly groups: RuntimeFeedbackSignalGroupRepository,
    private readonly candidates: LearningCandidateRepository,
    private readonly policy: RuntimeFeedbackPolicyService,
    private readonly redaction: RuntimeFeedbackRedactionService,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async ingest(rawSignal: unknown): Promise<RuntimeFeedbackIngestionResult> {
    const signal = runtimeFeedbackSignalSchema.parse(rawSignal);
    const now = new Date(signal.occurred_at ?? new Date().toISOString());
    const dedupeFingerprintHash = hashDedupeFingerprint(
      signal.dedupe_fingerprint,
    );
    const group = await this.upsertGroup(signal, now, dedupeFingerprintHash);
    const decision = this.policy.evaluate({
      signal,
      occurrenceCount: group.window_occurrence_count,
      windowStartedAt: group.window_started_at,
      existingCandidateId: group.candidateId,
      cooldownUntil: group.cooldown_until,
      now,
    });

    await this.emitSignalIngested(signal, group, dedupeFingerprintHash);

    if (!decision.promote) {
      const updatedGroup =
        await this.groups.updateSkippedMetadataIfCandidateMissing(group.id, {
          diagnostics_json: buildSkippedDiagnostics({
            dedupeFingerprintHash,
            decision,
            group,
            now,
            signal,
            skippedReason: decision.skippedReason,
          }),
          last_skipped_reason: decision.skippedReason,
          ...(decision.resetWindow
            ? { window_occurrence_count: 1, window_started_at: now }
            : {}),
        });

      if (!updatedGroup) {
        throw new InternalServerErrorException(
          `Runtime feedback group ${group.id} was not found while recording skipped reason`,
        );
      }

      if (updatedGroup.candidateId) {
        await this.emitSignalSkipped(signal, group.id, 'candidate_exists');

        return {
          groupId: group.id,
          candidateId: updatedGroup.candidateId,
          promoted: false,
          skippedReason: 'candidate_exists',
        };
      }

      await this.emitSignalSkipped(signal, group.id, decision.skippedReason);

      return {
        groupId: group.id,
        candidateId: group.candidateId,
        promoted: false,
        skippedReason: decision.skippedReason,
      };
    }

    const candidate = await this.createCandidateOrLinkExisting(
      signal,
      group,
      now,
      dedupeFingerprintHash,
    );

    if (!candidate.created) {
      await this.emitSignalSkipped(signal, group.id, 'candidate_exists');

      return {
        groupId: group.id,
        candidateId: candidate.id,
        promoted: false,
        skippedReason: 'candidate_exists',
      };
    }

    const updatedGroup = await this.groups.updateGroup(group.id, {
      candidateId: candidate.id,
      candidate_created_at: now,
      cooldown_until: decision.cooldownUntil,
      diagnostics_json: buildPromotionDiagnostics({
        candidateId: candidate.id,
        dedupeFingerprintHash,
        group,
        now,
        signal,
      }),
      last_skipped_reason: null,
    });

    if (!updatedGroup) {
      throw new InternalServerErrorException(
        `Runtime feedback group ${group.id} was not found after candidate creation`,
      );
    }

    await this.emitCandidateCreated(
      signal,
      group.id,
      candidate.id,
      dedupeFingerprintHash,
    );

    return {
      groupId: group.id,
      candidateId: candidate.id,
      promoted: true,
      skippedReason: null,
    };
  }

  private async upsertGroup(
    signal: RuntimeFeedbackSignal,
    now: Date,
    dedupeFingerprintHash: string,
  ): Promise<RuntimeFeedbackSignalGroup> {
    const existing = await this.groups.findByFingerprint(dedupeFingerprintHash);
    const evidence = sanitizeEvidence(signal.evidence, this.redaction);
    const examples = this.redaction.sanitizeExamples(signal.examples);

    if (!existing) {
      try {
        return await this.groups.createGroup({
          dedupe_fingerprint: dedupeFingerprintHash,
          signal_type: signal.signal_type,
          source_module: signal.source_module,
          scope_type: signal.scope.scope_type,
          scopeId: signal.scope.scope_id ?? null,
          actor_json: signal.actor ?? {},
          affected_json: signal.affected ?? {},
          evidence_json: evidence,
          examples_json: examples,
          occurrence_count: 1,
          window_occurrence_count: 1,
          max_confidence: signal.confidence,
          max_severity: signal.severity,
          first_seen_at: now,
          window_started_at: now,
          last_seen_at: now,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        const racedExisting = await this.groups.findByFingerprint(
          dedupeFingerprintHash,
        );

        if (!racedExisting) {
          throw error;
        }

        return this.updateExistingGroup(
          racedExisting,
          signal,
          now,
          evidence,
          examples,
        );
      }
    }

    return this.updateExistingGroup(existing, signal, now, evidence, examples);
  }

  private async updateExistingGroup(
    existing: RuntimeFeedbackSignalGroup,
    signal: RuntimeFeedbackSignal,
    now: Date,
    evidence: RuntimeFeedbackEvidence[],
    examples: RuntimeFeedbackExample[],
  ): Promise<RuntimeFeedbackSignalGroup> {
    const updated = await this.groups.incrementOccurrence(existing.id, {
      evidence,
      examples,
      confidence: signal.confidence,
      severity: signal.severity,
      lastSeenAt: now,
      maxEvidenceItems: MAX_EVIDENCE_ITEMS,
      maxExampleItems: MAX_EXAMPLE_ITEMS,
    });

    if (!updated) {
      throw new InternalServerErrorException(
        `Runtime feedback group ${existing.id} was not found during update`,
      );
    }

    return updated;
  }

  private createCandidate(
    signal: RuntimeFeedbackSignal,
    group: RuntimeFeedbackSignalGroup,
    dedupeFingerprintHash: string,
  ): Promise<LearningCandidate> {
    return this.candidates.create({
      scope_type: signal.scope.scope_type,
      scopeId: signal.scope.scope_id ?? null,
      candidate_type: RUNTIME_FEEDBACK_CANDIDATE_TYPE,
      title: deriveTitle(signal),
      summary: deriveSummary(
        signal,
        group.occurrence_count,
        dedupeFingerprintHash,
      ),
      fingerprint: dedupeFingerprintHash,
      signals_json: {
        signal_type: signal.signal_type,
        source_module: signal.source_module,
        dedupe_fingerprint_hash: dedupeFingerprintHash,
        actor: signal.actor ?? {},
        affected: signal.affected ?? {},
        evidence: group.evidence_json,
        examples: group.examples_json,
        occurrence_count: group.occurrence_count,
        window_occurrence_count: group.window_occurrence_count,
      },
      score: signal.confidence,
      confidence: signal.confidence,
      recurrence_count: group.occurrence_count,
      status: 'pending',
      diagnostics_json: {
        feedback_group_id: group.id,
        dedupe_fingerprint_hash: dedupeFingerprintHash,
      },
    });
  }

  private async createCandidateOrLinkExisting(
    signal: RuntimeFeedbackSignal,
    group: RuntimeFeedbackSignalGroup,
    now: Date,
    dedupeFingerprintHash: string,
  ): Promise<{ id: string; created: boolean }> {
    try {
      const candidate = await this.createCandidate(
        signal,
        group,
        dedupeFingerprintHash,
      );

      return { id: candidate.id, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const existingCandidate = await this.candidates.findByFingerprint(
        dedupeFingerprintHash,
      );

      if (!existingCandidate) {
        throw error;
      }

      const updatedGroup = await this.groups.updateGroup(group.id, {
        candidateId: existingCandidate.id,
        candidate_created_at: group.candidate_created_at ?? now,
        last_skipped_reason: 'candidate_exists',
      });

      if (!updatedGroup) {
        throw new InternalServerErrorException(
          `Runtime feedback group ${group.id} was not found while linking existing candidate`,
        );
      }

      return { id: existingCandidate.id, created: false };
    }
  }

  private emitSignalIngested(
    signal: RuntimeFeedbackSignal,
    group: RuntimeFeedbackSignalGroup,
    dedupeFingerprintHash: string,
  ): Promise<void> {
    return this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: RUNTIME_FEEDBACK_EVENT_NAMES.signalIngested,
      outcome: 'success',
      workflowRunId: signal.affected?.workflow_run_id,
      jobId: signal.affected?.job_id,
      payload: {
        group_id: group.id,
        signal_type: signal.signal_type,
        dedupe_fingerprint_hash: dedupeFingerprintHash,
        occurrence_count: group.occurrence_count,
      },
    });
  }

  private emitSignalSkipped(
    signal: RuntimeFeedbackSignal,
    groupId: string,
    skippedReason: RuntimeFeedbackSkippedReason | null,
  ): Promise<void> {
    return this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: RUNTIME_FEEDBACK_EVENT_NAMES.signalSkipped,
      outcome: 'denied',
      workflowRunId: signal.affected?.workflow_run_id,
      jobId: signal.affected?.job_id,
      payload: {
        group_id: groupId,
        signal_type: signal.signal_type,
        skipped_reason: skippedReason,
      },
    });
  }

  private emitCandidateCreated(
    signal: RuntimeFeedbackSignal,
    groupId: string,
    candidateId: string,
    dedupeFingerprintHash: string,
  ): Promise<void> {
    return this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: RUNTIME_FEEDBACK_EVENT_NAMES.candidateCreated,
      outcome: 'success',
      workflowRunId: signal.affected?.workflow_run_id,
      jobId: signal.affected?.job_id,
      payload: {
        group_id: groupId,
        candidate_id: candidateId,
        signal_type: signal.signal_type,
        dedupe_fingerprint_hash: dedupeFingerprintHash,
      },
    });
  }
}

function sanitizeEvidence(
  evidence: RuntimeFeedbackEvidence[],
  redaction: RuntimeFeedbackRedactionService,
): RuntimeFeedbackEvidence[] {
  return evidence.map((item) => ({
    ...item,
    summary: redaction.sanitizeSummary(item.summary),
  }));
}

function deriveTitle(signal: RuntimeFeedbackSignal): string {
  return `${signal.signal_type}: ${
    signal.affected?.tool_name ??
    signal.affected?.failure_class ??
    signal.source_module
  }`;
}

function deriveSummary(
  signal: RuntimeFeedbackSignal,
  count: number,
  dedupeFingerprintHash: string,
): string {
  return `Repeated ${signal.signal_type} signal observed ${count} times for fingerprint hash ${dedupeFingerprintHash}.`;
}

function hashDedupeFingerprint(dedupeFingerprint: string): string {
  return createHash('sha256').update(dedupeFingerprint).digest('hex');
}

function buildSkippedDiagnostics(params: {
  dedupeFingerprintHash: string;
  decision: { resetWindow: boolean };
  group: RuntimeFeedbackSignalGroup;
  now: Date;
  signal: RuntimeFeedbackSignal;
  skippedReason: RuntimeFeedbackSkippedReason | null;
}): Record<string, unknown> {
  return {
    dedupe_fingerprint_hash: params.dedupeFingerprintHash,
    latest_occurrence_at: params.now.toISOString(),
    occurrence_count: params.group.occurrence_count,
    signal_type: params.signal.signal_type,
    skipped_reason: params.skippedReason,
    source_module: params.signal.source_module,
    window_occurrence_count: params.decision.resetWindow
      ? 1
      : params.group.window_occurrence_count,
    window_started_at: (params.decision.resetWindow
      ? params.now
      : params.group.window_started_at
    ).toISOString(),
  };
}

function buildPromotionDiagnostics(params: {
  candidateId: string;
  dedupeFingerprintHash: string;
  group: RuntimeFeedbackSignalGroup;
  now: Date;
  signal: RuntimeFeedbackSignal;
}): Record<string, unknown> {
  return {
    dedupe_fingerprint_hash: params.dedupeFingerprintHash,
    occurrence_count: params.group.occurrence_count,
    promoted_at: params.now.toISOString(),
    promoted_candidate_id: params.candidateId,
    signal_type: params.signal.signal_type,
    skipped_reason: null,
    source_module: params.signal.source_module,
    window_occurrence_count: params.group.window_occurrence_count,
    window_started_at: params.group.window_started_at.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}
