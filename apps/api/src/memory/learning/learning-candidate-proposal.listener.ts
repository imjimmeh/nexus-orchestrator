import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RecordLearningService } from './record-learning.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  ORCHESTRATION_CYCLE_CANDIDATE_ENABLED_DEFAULT,
  ORCHESTRATION_CYCLE_CANDIDATE_ENABLED_KEY,
  ORCHESTRATION_CYCLE_LESSON_TEMPLATE,
} from '../../settings/orchestration-cycle-candidate.settings.constants';

const LEARNING_CANDIDATE_PROPOSED_EVENT = 'learning.candidate.proposed.v1';

interface LearningCandidateProposalPayload {
  scope_type: string;
  scope_id: string;
  lesson: string;
  evidence: Array<{ kind: string; id: string; summary: string }>;
  confidence: number;
  tags: string[];
  source_service?: string;
  orchestration_id?: string | null;
  retrospective_run_id?: string;
  cycle_decision?: string;
  trigger?: Record<string, unknown>;
}

@Injectable()
export class LearningCandidateProposalListener {
  private readonly logger = new Logger(LearningCandidateProposalListener.name);

  constructor(
    private readonly recordLearningService: RecordLearningService,
    private readonly settings: SystemSettingsService,
  ) {}

  @OnEvent(LEARNING_CANDIDATE_PROPOSED_EVENT)
  async handleLearningCandidateProposed(payload: unknown): Promise<void> {
    if (!isLearningCandidateProposalPayload(payload)) {
      this.logger.warn(
        'Ignoring invalid learning candidate proposal event payload.',
      );
      return;
    }

    const gateOn =
      (await this.settings.get<unknown>(
        ORCHESTRATION_CYCLE_CANDIDATE_ENABLED_KEY,
        ORCHESTRATION_CYCLE_CANDIDATE_ENABLED_DEFAULT,
      )) === true;
    if (!gateOn && ORCHESTRATION_CYCLE_LESSON_TEMPLATE.test(payload.lesson)) {
      this.logger.debug(
        `Dropping templated orchestration-cycle lesson for scope ${payload.scope_id}`,
      );
      return;
    }

    await this.recordLearningService.recordLearning(
      {},
      {
        scope_type: payload.scope_type,
        scope_id: payload.scope_id,
        lesson: payload.lesson,
        evidence: payload.evidence,
        confidence: payload.confidence,
        tags: payload.tags,
        provenance: {
          event_name: LEARNING_CANDIDATE_PROPOSED_EVENT,
          source_service: payload.source_service,
          orchestration_id: payload.orchestration_id,
          retrospective_run_id: payload.retrospective_run_id,
          cycle_decision: payload.cycle_decision,
          trigger: payload.trigger,
        },
      },
    );
  }
}

function isLearningCandidateProposalPayload(
  payload: unknown,
): payload is LearningCandidateProposalPayload {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    isNonEmptyString(payload.scope_type) &&
    isNonEmptyString(payload.scope_id) &&
    isNonEmptyString(payload.lesson) &&
    isEvidence(payload.evidence) &&
    isValidConfidence(payload.confidence) &&
    isStringArray(payload.tags)
  );
}

function isEvidence(
  evidence: unknown,
): evidence is Array<{ kind: string; id: string; summary: string }> {
  return (
    Array.isArray(evidence) &&
    evidence.length > 0 &&
    evidence.every(
      (item) =>
        isRecord(item) &&
        isNonEmptyString(item.kind) &&
        isNonEmptyString(item.id) &&
        isNonEmptyString(item.summary),
    )
  );
}

function isValidConfidence(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
