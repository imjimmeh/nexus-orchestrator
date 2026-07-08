import { Injectable } from '@nestjs/common';
import {
  buildModeDeniedReason,
  buildNotPublishedReason,
  buildNotRegisteredReason,
  buildPolicyDeniedReason,
  buildRuleDeniedReason,
} from '../tool/capability-preflight.helpers';
import type {
  PreflightCapabilityDecisionInput,
  PreflightCapabilityDecisionResult,
  ProfileToolDecision,
  ProfileToolPolicyInput,
  RuntimeSnapshotDecisionInput,
  RuntimeSnapshotDecisionResult,
} from './tool-policy-decision.service.types';

@Injectable()
export class ToolPolicyDecisionService {
  evaluateProfileToolPolicy(
    params: ProfileToolPolicyInput,
  ): ProfileToolDecision {
    const candidateNames = this.collectCandidateNames(
      params.toolName,
      params.candidateToolNames,
    );

    if (this.matchesAnyPolicyValue(candidateNames, params.deniedTools)) {
      return 'deny';
    }

    const allowed = this.matchesAnyPolicyValue(
      candidateNames,
      params.allowedTools,
    );
    if (!allowed) {
      return 'deny';
    }

    if (
      this.matchesAnyPolicyValue(candidateNames, params.approvalRequiredTools)
    ) {
      return 'approval_required';
    }

    return 'allow';
  }

  decidePreflightCapability(
    params: PreflightCapabilityDecisionInput,
  ): PreflightCapabilityDecisionResult {
    if (!params.isRegistered) {
      return {
        status: 'deny',
        deniedReason: buildNotRegisteredReason(params.toolName),
      };
    }

    if (params.publicationStatus && params.publicationStatus !== 'published') {
      return {
        status: 'deny',
        deniedReason: buildNotPublishedReason(
          params.toolName,
          params.publicationStatus,
        ),
      };
    }

    if (!params.allowedByPolicy) {
      return {
        status: 'deny',
        deniedReason: buildPolicyDeniedReason(params.toolName),
      };
    }

    if (params.ruleEffect === 'deny') {
      return {
        status: 'deny',
        deniedReason: buildRuleDeniedReason(params.toolName),
      };
    }

    if (params.ruleEffect === 'require_approval') {
      return { status: 'approval_required' };
    }

    if (params.ruleEffect === 'allow') {
      return { status: 'allow' };
    }

    if (params.modeOutcome === 'deny') {
      return {
        status: 'deny',
        deniedReason: buildModeDeniedReason(params.toolName),
      };
    }

    if (params.modeOutcome === 'require_approval') {
      return { status: 'approval_required' };
    }

    return { status: 'allow' };
  }

  decideRuntimeSnapshot(
    params: RuntimeSnapshotDecisionInput,
  ): RuntimeSnapshotDecisionResult {
    if (params.approvalRequiredTools.has(params.capabilityName)) {
      return {
        status: 'approval_required',
        reason: `Capability ${params.capabilityName} requires approval in this runtime context`,
      };
    }

    if (params.callableTools.has(params.capabilityName)) {
      return { status: 'allow' };
    }

    const deniedInfo = this.findDeniedCapabilityInfo(
      params.deniedTools,
      params.capabilityName,
    );
    return {
      status: 'denied',
      reason:
        deniedInfo.reason ||
        `Capability ${params.capabilityName} is not callable in this runtime context`,
      deniedReasonCode: deniedInfo.reasonCode,
    };
  }

  private collectCandidateNames(
    primaryToolName: string,
    aliases?: string[],
  ): Set<string> {
    const candidates = new Set<string>();
    const normalizedPrimary = primaryToolName.trim();
    if (normalizedPrimary.length > 0) {
      candidates.add(normalizedPrimary);
    }

    if (!aliases) {
      return candidates;
    }

    for (const alias of aliases) {
      const normalizedAlias = alias.trim();
      if (normalizedAlias.length > 0) {
        candidates.add(normalizedAlias);
      }
    }

    return candidates;
  }

  private matchesAnyPolicyValue(
    candidateNames: Set<string>,
    policyValues: string[] | undefined,
  ): boolean {
    if (!policyValues || policyValues.length === 0) {
      return false;
    }

    if (policyValues.includes('*')) {
      return true;
    }

    for (const name of candidateNames) {
      if (policyValues.includes(name)) {
        return true;
      }
    }

    return false;
  }

  private findDeniedCapabilityInfo(
    deniedTools: Array<Record<string, unknown>>,
    capabilityName: string,
  ): { reason?: string; reasonCode?: string } {
    for (const denied of deniedTools) {
      if (!denied || typeof denied !== 'object') {
        continue;
      }

      const toolName = denied.toolName;
      if (typeof toolName === 'string' && toolName === capabilityName) {
        const reason =
          typeof denied.reason === 'string' && denied.reason.length > 0
            ? denied.reason
            : undefined;
        const reasonCode =
          typeof denied.reasonCode === 'string' && denied.reasonCode.length > 0
            ? denied.reasonCode
            : undefined;

        return { reason, reasonCode };
      }
    }

    return {};
  }
}
