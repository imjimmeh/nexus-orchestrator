import { Injectable } from '@nestjs/common';
import type {
  FailureClassificationDecision,
  RepairEligibility,
} from './failure-classification.types';
import { REPAIR_POLICY_CONFIG } from './repair-policy.config';

@Injectable()
export class RepairPolicyService {
  applyPolicy(
    classification: Omit<
      FailureClassificationDecision,
      'eligibility' | 'allowedRepairActionIds'
    >,
  ): FailureClassificationDecision {
    if (classification.safetyTags?.includes('destructive_operation')) {
      return {
        ...classification,
        eligibility: 'deny',
        allowedRepairActionIds: [],
      };
    }

    const policy = REPAIR_POLICY_CONFIG[classification.class];
    if (!policy) {
      return {
        ...classification,
        eligibility: 'deny',
        allowedRepairActionIds: [],
      };
    }

    if (policy.humanRequired) {
      return {
        ...classification,
        eligibility: 'human_required',
        allowedRepairActionIds: [],
      };
    }

    if (policy.allowedRepairActionIds.length > 0) {
      const eligibility: RepairEligibility =
        classification.confidence >= policy.minimumConfidence
          ? 'allow'
          : 'human_required';

      return {
        ...classification,
        eligibility,
        allowedRepairActionIds:
          eligibility === 'allow' ? [...policy.allowedRepairActionIds] : [],
      };
    }

    return {
      ...classification,
      eligibility: 'deny',
      allowedRepairActionIds: [],
    };
  }
}
