import { Injectable } from '@nestjs/common';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type {
  LearningPromotionPolicyDecision,
  LearningPromotionPolicyOptions,
} from './learning-promotion.types';

const POLICY_NAME = 'runtime-learning-auto-promotion';
const POLICY_VERSION = '1.0.0';
const DEFAULT_MINIMUM_CONFIDENCE = 0.5;

@Injectable()
export class LearningPromotionPolicyService {
  evaluate(
    candidate: LearningCandidate,
    options: LearningPromotionPolicyOptions = {},
  ): LearningPromotionPolicyDecision {
    const minimumConfidence =
      options.minimumConfidence ?? DEFAULT_MINIMUM_CONFIDENCE;
    const base = {
      policyName: POLICY_NAME,
      policyVersion: POLICY_VERSION,
      minimumConfidence,
      confidence: candidate.confidence,
    };

    if (candidate.promoted_memory_segment_id || candidate.promoted_at) {
      return {
        ...base,
        approved: false,
        code: 'already_promoted',
        reason: 'Learning candidate has already been promoted.',
      };
    }

    if (
      candidate.status === 'promotion_in_progress' &&
      !options.allowClaimedCandidate
    ) {
      return {
        ...base,
        approved: false,
        code: 'not_pending',
        reason: 'Learning candidate is not currently claimable for promotion.',
      };
    }

    if (
      candidate.status !== 'pending' &&
      candidate.status !== 'promotion_in_progress'
    ) {
      return {
        ...base,
        approved: false,
        code: 'not_pending',
        reason: 'Only pending learning candidates can be promoted.',
      };
    }

    if (!hasDurableLesson(candidate)) {
      return {
        ...base,
        approved: false,
        code: 'missing_lesson',
        reason: 'Learning candidate does not contain a durable lesson.',
      };
    }

    if (candidate.confidence < minimumConfidence) {
      return {
        ...base,
        approved: false,
        code: 'low_confidence',
        reason:
          'Learning candidate confidence is below the promotion threshold.',
      };
    }

    return {
      ...base,
      approved: true,
      code: 'approved',
      reason: 'Learning candidate satisfies the promotion policy.',
    };
  }
}

function hasDurableLesson(candidate: LearningCandidate): boolean {
  return (
    Boolean(readNonBlankString(candidate.signals_json.lesson)) ||
    Boolean(readNonBlankString(candidate.summary))
  );
}

function readNonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
