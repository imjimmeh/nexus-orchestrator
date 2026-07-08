import { describe, expect, it } from 'vitest';
import type { FailureClassificationDecision } from './failure-classification.types';
import { REPAIR_POLICY_CONFIG } from './repair-policy.config';
import { RepairPolicyService } from './repair-policy.service';

function classification(
  overrides: Partial<FailureClassificationDecision>,
): Omit<
  FailureClassificationDecision,
  'eligibility' | 'allowedRepairActionIds'
> {
  return {
    class: 'ambiguous_failure',
    confidence: 0.9,
    reason: 'classified by test',
    evidenceReferences: [],
    ...overrides,
  };
}

describe('RepairPolicyService', () => {
  const service = new RepairPolicyService();

  it('exposes dependency_missing policy metadata outside policy evaluation', () => {
    expect(REPAIR_POLICY_CONFIG.dependency_missing).toEqual(
      expect.objectContaining({
        minimumConfidence: 0.7,
        allowedRepairActionIds: ['repair.dependency.add_declared_package'],
        defaultExecutor: 'sysadmin_workflow',
      }),
    );
  });

  it.each([
    ['dependency_missing', ['repair.dependency.add_declared_package']],
    ['config_missing_local', ['repair.config.create_local_placeholder']],
    [
      'runtime_artifact_stale',
      [
        'doctor.runtime_artifact.refresh_stale_artifacts',
        'doctor.polling.clear_stale_markers',
        'doctor.workflow_run.requeue_recoverable',
        'doctor.git.clean_worktrees',
      ],
    ],
  ] as const)(
    'allows %s with configured repair actions',
    (policyClass, actions) => {
      expect(
        service.applyPolicy(classification({ class: policyClass })),
      ).toEqual(
        expect.objectContaining({
          eligibility: 'allow',
          allowedRepairActionIds: actions,
        }),
      );
    },
  );

  it('denies credential_missing repair', () => {
    expect(
      service.applyPolicy(classification({ class: 'credential_missing' })),
    ).toEqual(
      expect.objectContaining({
        eligibility: 'deny',
        allowedRepairActionIds: [],
      }),
    );
  });

  it('denies classifications tagged as destructive operations regardless of class', () => {
    expect(
      service.applyPolicy(
        classification({
          class: 'dependency_missing',
          confidence: 0.95,
          safetyTags: ['destructive_operation'],
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        eligibility: 'deny',
        allowedRepairActionIds: [],
        safetyTags: ['destructive_operation'],
      }),
    );
  });

  it.each(['tool_contract_mismatch', 'ambiguous_failure'] as const)(
    'requires humans for %s',
    (policyClass) => {
      expect(
        service.applyPolicy(classification({ class: policyClass })),
      ).toEqual(
        expect.objectContaining({
          eligibility: 'human_required',
          allowedRepairActionIds: [],
        }),
      );
    },
  );

  it('downgrades low-confidence allowlisted classes to human_required', () => {
    expect(
      service.applyPolicy(
        classification({ class: 'dependency_missing', confidence: 0.69 }),
      ),
    ).toEqual(
      expect.objectContaining({
        eligibility: 'human_required',
        allowedRepairActionIds: [],
      }),
    );
  });

  it('routes split_coverage_invalid to an allowed (non-human) repair action', () => {
    const decision = service.applyPolicy({
      class: 'split_coverage_invalid',
      confidence: 0.85,
      reason: 'x',
      evidenceReferences: [],
    });

    expect(decision.eligibility).toBe('allow');
    expect(decision.allowedRepairActionIds).toContain(
      'doctor.workflow_run.redispatch_producer_with_feedback',
    );
  });
});
