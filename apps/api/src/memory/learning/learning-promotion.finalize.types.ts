import type { IMemorySegment } from '@nexus/core';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type {
  LearningPromotionOptions,
  LearningPromotionPolicyDecision,
  LearningPromotionResult,
  PromotionFailureStage,
  SegmentDestination,
} from './learning-promotion.types';
import type { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import type { LearningPromotionPolicyService } from './learning-promotion-policy.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { MemoryContradictionService } from './memory-contradiction.service';

/** Failure stages the finalize steps can emit. */
export type FinalizeFailureStage = Extract<
  PromotionFailureStage,
  'policy_denied' | 'write_memory' | 'finalize_promotion'
>;

/**
 * Bundle of dependencies the auto-promotion step functions need. Built once
 * per service instance so the step functions stay narrowly typed + unit-
 * testable in isolation while the service keeps all private helpers
 * (e.g. `createMemorySegment`, `returnExistingPromotion`) on itself.
 */
export interface FinalizeStepDependencies {
  readonly candidates: LearningCandidateRepository;
  readonly policy: LearningPromotionPolicyService;
  readonly settings: SystemSettingsService;
  readonly contradiction?: MemoryContradictionService;
  readonly findExistingMemorySegment: (
    candidate: LearningCandidate,
  ) => Promise<IMemorySegment | null>;
  readonly createMemorySegment: (
    candidate: LearningCandidate,
    decision: LearningPromotionPolicyDecision,
    options: { requestedBy?: string; destination?: SegmentDestination },
  ) => Promise<IMemorySegment>;
  readonly returnExistingPromotion: (
    candidate: LearningCandidate & { promoted_memory_segment_id: string },
  ) => Promise<LearningPromotionResult>;
  readonly emitSucceeded: (
    candidate: LearningCandidate,
    memorySegment: IMemorySegment,
    decision: LearningPromotionPolicyDecision,
    options?: LearningPromotionOptions,
  ) => Promise<void>;
  readonly emitPromoted: (
    candidate: LearningCandidate,
    memorySegment: IMemorySegment,
    decision: LearningPromotionPolicyDecision,
  ) => Promise<void>;
  readonly emitFailed: (
    candidate: LearningCandidate,
    decision: LearningPromotionPolicyDecision,
    memorySegment: IMemorySegment | null,
    failureStage: FinalizeFailureStage,
    options?: LearningPromotionOptions,
  ) => Promise<void>;
}
