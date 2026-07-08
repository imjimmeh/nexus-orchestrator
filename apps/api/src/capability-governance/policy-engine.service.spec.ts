import { describe, expect, it } from 'vitest';
import { PolicyEngineService } from './policy-engine.service';
import type { PolicyEngineInput } from './policy-engine.service.types';

describe('PolicyEngineService', () => {
  const service = new PolicyEngineService();
  const passingInput = (
    overrides: Partial<PolicyEngineInput> = {},
  ): PolicyEngineInput => ({
    capabilityName: 'query_memory',
    isRegistered: true,
    ...overrides,
  });

  describe('phase pipeline ordering', () => {
    it('allows when all phases pass', () => {
      const result = service.decide(passingInput());
      expect(result.status).toBe('allow');
      expect(result.explanation.decidedBy).toBe('default_allow');
    });

    it('phase 1: denies when capability is not registered', () => {
      const result = service.decide(passingInput({ isRegistered: false }));
      expect(result.status).toBe('deny');
      expect(result.deniedReason?.reasonCode).toBe('tool_not_registered');
      expect(result.explanation.decidedBy).toBe('registration_check');
    });

    it('phase 2: denies when publication status is not published', () => {
      const result = service.decide(
        passingInput({ publicationStatus: 'draft' }),
      );
      expect(result.status).toBe('deny');
      expect(result.deniedReason?.reasonCode).toBe('tool_not_published');
      expect(result.explanation.decidedBy).toBe('publication_check');
    });

    it('phase 2: passes when publication status is published', () => {
      const result = service.decide(
        passingInput({ publicationStatus: 'published' }),
      );
      expect(result.status).toBe('allow');
    });

    it('phase 2: passes when publication status is undefined', () => {
      const result = service.decide(
        passingInput({ publicationStatus: undefined }),
      );
      expect(result.status).toBe('allow');
    });

    it('phase 3: denies when profile decision is deny', () => {
      const result = service.decide(passingInput({ profileDecision: 'deny' }));
      expect(result.status).toBe('deny');
      expect(result.deniedReason?.reasonCode).toBe('policy_denied');
      expect(result.explanation.decidedBy).toBe('profile_deny');
    });

    it('phase 4: denies when profile decision is unchecked', () => {
      const result = service.decide(
        passingInput({ profileDecision: 'unchecked' }),
      );
      expect(result.status).toBe('deny');
      expect(result.deniedReason?.reasonCode).toBe('policy_denied');
      expect(result.explanation.decidedBy).toBe('profile_allow');
    });

    it('phase 4: passes when profile allows', () => {
      const result = service.decide(passingInput({ profileDecision: 'allow' }));
      expect(result.status).toBe('allow');
    });

    it('phase 5: denies when workflow denies', () => {
      const result = service.decide(passingInput({ workflowDenied: true }));
      expect(result.status).toBe('deny');
      expect(result.deniedReason?.reasonCode).toBe('policy_denied');
      expect(result.explanation.decidedBy).toBe('workflow_deny');
    });

    it('phase 6: denies when not allowed by workflow', () => {
      const result = service.decide(passingInput({ workflowAllowed: false }));
      expect(result.status).toBe('deny');
      expect(result.explanation.decidedBy).toBe('workflow_allow');
    });

    it('phase 7: denies when rule effect is deny', () => {
      const result = service.decide(passingInput({ ruleEffect: 'deny' }));
      expect(result.status).toBe('deny');
      expect(result.deniedReason?.reasonCode).toBe('rule_denied');
      expect(result.explanation.decidedBy).toBe('dynamic_rule');
    });

    it('phase 7: approval_required when rule effect is require_approval', () => {
      const result = service.decide(
        passingInput({ ruleEffect: 'require_approval' }),
      );
      expect(result.status).toBe('approval_required');
      expect(result.explanation.decidedBy).toBe('dynamic_rule');
    });

    it('phase 8: denies when mode outcome denies', () => {
      const result = service.decide(passingInput({ modeOutcome: 'deny' }));
      expect(result.status).toBe('deny');
      expect(result.deniedReason?.reasonCode).toBe('mode_denied');
      expect(result.explanation.decidedBy).toBe('mode_gate');
    });

    it('phase 8: approval_required when mode requires approval', () => {
      const result = service.decide(
        passingInput({ modeOutcome: 'require_approval' }),
      );
      expect(result.status).toBe('approval_required');
      expect(result.explanation.decidedBy).toBe('mode_gate');
    });

    it('phase 9: approval_required when profile requires approval', () => {
      const result = service.decide(
        passingInput({ approvalRequiredByProfile: true }),
      );
      expect(result.status).toBe('approval_required');
      expect(result.explanation.decidedBy).toBe('approval_override');
    });
  });

  describe('explanation completeness', () => {
    it('records all phases up to the deciding phase on deny', () => {
      const result = service.decide(passingInput({ profileDecision: 'deny' }));
      expect(result.explanation.phases.length).toBeGreaterThanOrEqual(3);
      expect(result.explanation.phases[0].phase).toBe('registration_check');
      expect(result.explanation.phases[0].outcome).toBe('pass');
      expect(result.explanation.phases[1].phase).toBe('publication_check');
      expect(result.explanation.phases[1].outcome).toBe('pass');
      expect(result.explanation.phases[2].phase).toBe('profile_deny');
      expect(result.explanation.phases[2].outcome).toBe('deny');
    });

    it('records all phases as pass on allow', () => {
      const result = service.decide(passingInput());
      const phases = result.explanation.phases;
      const passPhases = phases.filter((p) => p.outcome === 'pass');
      expect(passPhases.length).toBe(phases.length);
      expect(result.explanation.decidedBy).toBe('default_allow');
    });
  });

  describe('profile decision with approval_required', () => {
    it('passes profile_approval_required and then hits approval_override', () => {
      const result = service.decide(
        passingInput({
          profileDecision: 'approval_required',
          approvalRequiredByProfile: true,
        }),
      );
      expect(result.status).toBe('approval_required');
      expect(result.explanation.decidedBy).toBe('approval_override');
    });
  });

  describe('edge cases', () => {
    it('handles undefined modeOutcome', () => {
      const result = service.decide(passingInput({ modeOutcome: undefined }));
      expect(result.status).toBe('allow');
    });

    it('handles null publicationStatus', () => {
      const result = service.decide(passingInput({ publicationStatus: null }));
      expect(result.status).toBe('allow');
    });

    it('handles null ruleEffect', () => {
      const result = service.decide(passingInput({ ruleEffect: null }));
      expect(result.status).toBe('allow');
    });
  });
});
