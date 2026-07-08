import { Injectable } from '@nestjs/common';
import {
  buildModeDeniedReason,
  buildNotPublishedReason,
  buildNotRegisteredReason,
  buildPolicyDeniedReason,
  buildRuleDeniedReason,
} from '../tool/capability-preflight.helpers';
import type {
  PolicyDecision,
  PolicyEngineInput,
  PolicyEnginePhaseResult,
} from './policy-engine.service.types';

@Injectable()
export class PolicyEngineService {
  decide(input: PolicyEngineInput): PolicyDecision {
    const phases: PolicyEnginePhaseResult[] = [];
    const name = input.capabilityName;

    const record = (
      phase: string,
      outcome: PolicyEnginePhaseResult['outcome'],
    ) => phases.push({ phase, outcome });

    const deny = (reason: PolicyDecision): PolicyDecision => ({
      ...reason,
      explanation: { phases, decidedBy: reason.explanation.decidedBy },
    });

    const result = this.runPhase1(input, phases, record, name, deny);
    if (result) return result;
    const result2 = this.runPhase2(input, phases, record, name, deny);
    if (result2) return result2;

    const profileDeny = this.runProfileDeny(input, phases, record, name, deny);
    if (profileDeny) return profileDeny;

    const profileAllow = this.runProfileAllow(
      input,
      phases,
      record,
      name,
      deny,
    );
    if (profileAllow) return profileAllow;

    const workflowDeny = this.runWorkflowDeny(
      input,
      phases,
      record,
      name,
      deny,
    );
    if (workflowDeny) return workflowDeny;

    const workflowAllow = this.runWorkflowAllow(
      input,
      phases,
      record,
      name,
      deny,
    );
    if (workflowAllow) return workflowAllow;

    const rule = this.runDynamicRule(input, phases, record, name);
    if (rule) return rule;

    const mode = this.runModeGate(input, phases, record, name);
    if (mode) return mode;

    const approval = this.runApprovalOverride(input, phases, record);
    if (approval) return approval;

    record('default_allow', 'pass');
    return {
      status: 'allow',
      explanation: { phases, decidedBy: 'default_allow' },
    };
  }

  private runPhase1(
    input: PolicyEngineInput,
    phases: PolicyEnginePhaseResult[],
    record: (
      phase: string,
      outcome: PolicyEnginePhaseResult['outcome'],
    ) => void,
    name: string,
    deny: (r: PolicyDecision) => PolicyDecision,
  ): PolicyDecision | null {
    if (input.isRegistered) {
      record('registration_check', 'pass');
      return null;
    }
    record('registration_check', 'deny');
    return deny({
      status: 'deny',
      deniedReason: buildNotRegisteredReason(name),
      explanation: { phases: [], decidedBy: 'registration_check' },
    });
  }

  private runPhase2(
    input: PolicyEngineInput,
    phases: PolicyEnginePhaseResult[],
    record: (
      phase: string,
      outcome: PolicyEnginePhaseResult['outcome'],
    ) => void,
    name: string,
    deny: (r: PolicyDecision) => PolicyDecision,
  ): PolicyDecision | null {
    if (
      input.publicationStatus === undefined ||
      input.publicationStatus === null ||
      input.publicationStatus === 'published'
    ) {
      record('publication_check', 'pass');
      return null;
    }
    record('publication_check', 'deny');
    return deny({
      status: 'deny',
      deniedReason: buildNotPublishedReason(name, input.publicationStatus),
      explanation: { phases: [], decidedBy: 'publication_check' },
    });
  }

  private runProfileDeny(
    input: PolicyEngineInput,
    phases: PolicyEnginePhaseResult[],
    record: (
      phase: string,
      outcome: PolicyEnginePhaseResult['outcome'],
    ) => void,
    name: string,
    deny: (r: PolicyDecision) => PolicyDecision,
  ): PolicyDecision | null {
    if (input.profileDecision !== 'deny') {
      record('profile_deny', 'pass');
      return null;
    }
    record('profile_deny', 'deny');
    return deny({
      status: 'deny',
      deniedReason: buildPolicyDeniedReason(
        name,
        'profile',
        'workflow_context',
      ),
      explanation: { phases: [], decidedBy: 'profile_deny' },
    });
  }

  private runProfileAllow(
    input: PolicyEngineInput,
    phases: PolicyEnginePhaseResult[],
    record: (
      phase: string,
      outcome: PolicyEnginePhaseResult['outcome'],
    ) => void,
    name: string,
    deny: (r: PolicyDecision) => PolicyDecision,
  ): PolicyDecision | null {
    if (input.profileDecision !== 'unchecked') {
      record('profile_allow', 'pass');
      return null;
    }
    record('profile_allow', 'deny');
    return deny({
      status: 'deny',
      deniedReason: buildPolicyDeniedReason(
        name,
        'profile',
        'workflow_context',
      ),
      explanation: { phases: [], decidedBy: 'profile_allow' },
    });
  }

  private runWorkflowDeny(
    input: PolicyEngineInput,
    phases: PolicyEnginePhaseResult[],
    record: (
      phase: string,
      outcome: PolicyEnginePhaseResult['outcome'],
    ) => void,
    name: string,
    deny: (r: PolicyDecision) => PolicyDecision,
  ): PolicyDecision | null {
    if (input.workflowDenied !== true) {
      record('workflow_deny', 'pass');
      return null;
    }
    record('workflow_deny', 'deny');
    return deny({
      status: 'deny',
      deniedReason: buildPolicyDeniedReason(
        name,
        'workflow',
        'workflow_context',
      ),
      explanation: { phases: [], decidedBy: 'workflow_deny' },
    });
  }

  private runWorkflowAllow(
    input: PolicyEngineInput,
    phases: PolicyEnginePhaseResult[],
    record: (
      phase: string,
      outcome: PolicyEnginePhaseResult['outcome'],
    ) => void,
    name: string,
    deny: (r: PolicyDecision) => PolicyDecision,
  ): PolicyDecision | null {
    if (input.workflowAllowed !== false) {
      record('workflow_allow', 'pass');
      return null;
    }
    record('workflow_allow', 'deny');
    return deny({
      status: 'deny',
      deniedReason: buildPolicyDeniedReason(
        name,
        'workflow',
        'workflow_context',
      ),
      explanation: { phases: [], decidedBy: 'workflow_allow' },
    });
  }

  private runDynamicRule(
    input: PolicyEngineInput,
    phases: PolicyEnginePhaseResult[],
    record: (
      phase: string,
      outcome: PolicyEnginePhaseResult['outcome'],
    ) => void,
    name: string,
  ): PolicyDecision | null {
    if (input.ruleEffect === 'deny') {
      record('dynamic_rule', 'deny');
      return {
        status: 'deny',
        deniedReason: buildRuleDeniedReason(name, 'workflow_context'),
        explanation: { phases, decidedBy: 'dynamic_rule' },
      };
    }

    if (input.ruleEffect === 'require_approval') {
      record('dynamic_rule', 'approval_required');
      return {
        status: 'approval_required',
        explanation: { phases, decidedBy: 'dynamic_rule' },
      };
    }

    record('dynamic_rule', 'pass');
    return null;
  }

  private runModeGate(
    input: PolicyEngineInput,
    phases: PolicyEnginePhaseResult[],
    record: (
      phase: string,
      outcome: PolicyEnginePhaseResult['outcome'],
    ) => void,
    name: string,
  ): PolicyDecision | null {
    if (input.modeOutcome === 'deny') {
      record('mode_gate', 'deny');
      return {
        status: 'deny',
        deniedReason: buildModeDeniedReason(name, 'workflow_context'),
        explanation: { phases, decidedBy: 'mode_gate' },
      };
    }

    if (input.modeOutcome === 'require_approval') {
      record('mode_gate', 'approval_required');
      return {
        status: 'approval_required',
        explanation: { phases, decidedBy: 'mode_gate' },
      };
    }

    record('mode_gate', 'pass');
    return null;
  }

  private runApprovalOverride(
    input: PolicyEngineInput,
    phases: PolicyEnginePhaseResult[],
    record: (
      phase: string,
      outcome: PolicyEnginePhaseResult['outcome'],
    ) => void,
  ): PolicyDecision | null {
    if (input.approvalRequiredByProfile !== true) {
      record('approval_override', 'pass');
      return null;
    }
    record('approval_override', 'approval_required');
    return {
      status: 'approval_required',
      explanation: { phases, decidedBy: 'approval_override' },
    };
  }
}
