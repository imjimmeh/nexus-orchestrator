import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DelegationCircuitBreakerService } from './delegation-circuit-breaker.service';
import type { RuntimeFeedbackSignalGroupRepository } from '../../runtime/database/repositories/runtime-feedback-signal-group.repository';

describe('DelegationCircuitBreakerService', () => {
  let signalGroups: {
    findActiveFailureClassificationGroup: ReturnType<typeof vi.fn>;
  };
  let service: DelegationCircuitBreakerService;
  const previousThreshold = process.env.DELEGATION_CIRCUIT_BREAKER_THRESHOLD;

  beforeEach(() => {
    delete process.env.DELEGATION_CIRCUIT_BREAKER_THRESHOLD;
    signalGroups = {
      findActiveFailureClassificationGroup: vi.fn().mockResolvedValue(null),
    };
    service = new DelegationCircuitBreakerService(
      signalGroups as unknown as RuntimeFeedbackSignalGroupRepository,
    );
  });

  afterEach(() => {
    if (previousThreshold === undefined) {
      delete process.env.DELEGATION_CIRCUIT_BREAKER_THRESHOLD;
    } else {
      process.env.DELEGATION_CIRCUIT_BREAKER_THRESHOLD = previousThreshold;
    }
  });

  it('is closed when no active failure group exists', async () => {
    const result = await service.evaluate('wf-1');
    expect(result.open).toBe(false);
    expect(result.occurrences).toBe(0);
    expect(
      signalGroups.findActiveFailureClassificationGroup,
    ).toHaveBeenCalledWith({
      failureClass: 'tool_contract_mismatch',
      workflowId: 'wf-1',
    });
  });

  it('is closed when recurrences are below the threshold', async () => {
    signalGroups.findActiveFailureClassificationGroup.mockResolvedValue({
      window_occurrence_count: 2,
    });
    const result = await service.evaluate('wf-1');
    expect(result.open).toBe(false);
    expect(result.occurrences).toBe(2);
  });

  it('is open when recurrences reach the default threshold of 3', async () => {
    signalGroups.findActiveFailureClassificationGroup.mockResolvedValue({
      window_occurrence_count: 3,
    });
    const result = await service.evaluate('wf-1');
    expect(result.open).toBe(true);
    expect(result.threshold).toBe(3);
  });

  it('honours the DELEGATION_CIRCUIT_BREAKER_THRESHOLD override', async () => {
    process.env.DELEGATION_CIRCUIT_BREAKER_THRESHOLD = '5';
    signalGroups.findActiveFailureClassificationGroup.mockResolvedValue({
      window_occurrence_count: 4,
    });
    const result = await service.evaluate('wf-1');
    expect(result.open).toBe(false);
    expect(result.threshold).toBe(5);
  });
});
