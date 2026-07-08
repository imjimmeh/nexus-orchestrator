import { Injectable } from '@nestjs/common';
import type {
  RuntimeFeedbackSeverity,
  RuntimeFeedbackSignal,
} from '@nexus/core';
import type { RuntimeFeedbackSkippedReason } from './runtime-feedback.types';

export const MIN_CONFIDENCE = 0.75;
export const MIN_OCCURRENCES = 3;
export const AGGREGATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

interface RuntimeFeedbackPromotionDecision {
  promote: boolean;
  skippedReason: RuntimeFeedbackSkippedReason | null;
  cooldownUntil: Date | null;
  resetWindow: boolean;
}

@Injectable()
export class RuntimeFeedbackPolicyService {
  evaluate(params: {
    signal: RuntimeFeedbackSignal;
    occurrenceCount: number;
    windowStartedAt?: Date | null;
    existingCandidateId: string | null;
    cooldownUntil: Date | null;
    now: Date;
  }): RuntimeFeedbackPromotionDecision {
    if (params.existingCandidateId) {
      return {
        promote: false,
        skippedReason: 'candidate_exists',
        cooldownUntil: null,
        resetWindow: false,
      };
    }

    if (params.cooldownUntil && params.cooldownUntil > params.now) {
      return {
        promote: false,
        skippedReason: 'cooldown_active',
        cooldownUntil: null,
        resetWindow: false,
      };
    }

    if (params.signal.confidence < MIN_CONFIDENCE) {
      return {
        promote: false,
        skippedReason: 'confidence_below_threshold',
        cooldownUntil: null,
        resetWindow: false,
      };
    }

    if (
      params.windowStartedAt &&
      params.now.getTime() - params.windowStartedAt.getTime() >
        AGGREGATION_WINDOW_MS &&
      !isSeverityOverride(params.signal.severity)
    ) {
      return {
        promote: false,
        skippedReason: 'frequency_window_expired',
        cooldownUntil: null,
        resetWindow: true,
      };
    }

    if (
      params.occurrenceCount < MIN_OCCURRENCES &&
      !isSeverityOverride(params.signal.severity)
    ) {
      return {
        promote: false,
        skippedReason: 'frequency_below_threshold',
        cooldownUntil: null,
        resetWindow: false,
      };
    }

    return {
      promote: true,
      skippedReason: null,
      cooldownUntil: new Date(params.now.getTime() + COOLDOWN_MS),
      resetWindow: false,
    };
  }
}

function isSeverityOverride(severity: RuntimeFeedbackSeverity): boolean {
  return severity === 'critical' || severity === 'high';
}
