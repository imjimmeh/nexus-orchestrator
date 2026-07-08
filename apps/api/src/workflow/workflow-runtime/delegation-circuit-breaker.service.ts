import { Injectable, Logger } from '@nestjs/common';
import { RuntimeFeedbackSignalGroupRepository } from '../../runtime/database/repositories/runtime-feedback-signal-group.repository';

export const DELEGATION_CIRCUIT_BREAKER_THRESHOLD_ENV =
  'DELEGATION_CIRCUIT_BREAKER_THRESHOLD';
const DEFAULT_THRESHOLD = 3;
const CONTRACT_MISMATCH_FAILURE_CLASS = 'tool_contract_mismatch';

interface CircuitBreakerEvaluation {
  open: boolean;
  failureClass: string;
  occurrences: number;
  threshold: number;
}

/**
 * Stops the autonomous loop from re-launching a delegation that keeps failing
 * the same human-required way. When a target workflow has an unresolved
 * `tool_contract_mismatch` failure-classification signal group whose windowed
 * recurrence has reached the threshold, the breaker is **open** and the
 * launcher must skip the delegation (so a human can intervene) instead of
 * churning the board every cycle. Keyed on the resolved workflow definition id
 * + failure class — never globally — so one broken delegation cannot suppress
 * unrelated work. Read-only; recurrence accrues via the runtime-feedback
 * pipeline and clears when the signal group is resolved (a learning candidate
 * is created) or its window resets.
 */
@Injectable()
export class DelegationCircuitBreakerService {
  private readonly logger = new Logger(DelegationCircuitBreakerService.name);

  constructor(
    private readonly signalGroups: RuntimeFeedbackSignalGroupRepository,
  ) {}

  async evaluate(workflowId: string): Promise<CircuitBreakerEvaluation> {
    const threshold = this.resolveThreshold();
    const group = await this.signalGroups.findActiveFailureClassificationGroup({
      failureClass: CONTRACT_MISMATCH_FAILURE_CLASS,
      workflowId,
    });
    const occurrences = group?.window_occurrence_count ?? 0;
    const open = occurrences >= threshold;

    if (open) {
      this.logger.warn(
        `Delegation circuit OPEN for workflow ${workflowId}: ${occurrences.toString()} repeated ${CONTRACT_MISMATCH_FAILURE_CLASS} failures (threshold ${threshold.toString()}). Skipping re-launch until resolved.`,
      );
    }

    return {
      open,
      failureClass: CONTRACT_MISMATCH_FAILURE_CLASS,
      occurrences,
      threshold,
    };
  }

  private resolveThreshold(): number {
    const raw =
      process.env[DELEGATION_CIRCUIT_BREAKER_THRESHOLD_ENV]?.trim() ?? '';
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD;
  }
}
