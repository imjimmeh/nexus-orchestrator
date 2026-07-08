import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { assignmentTargetSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { ImprovementProposalService } from '../../../../improvement/improvement-proposal.service';
import { parseAssignmentTargets } from '../../../../improvement/appliers/assignment-target.helpers';
import type {
  SuggestSkillAssignmentContext,
  SuggestSkillAssignmentProposalService,
  SuggestSkillAssignmentResult,
} from './suggest-skill-assignment.tool.types';

const SUGGEST_SKILL_ASSIGNMENT_SOURCE_TOOL = 'suggest_skill_assignment';
const IMPROVEMENT_KIND_SKILL_ASSIGNMENT = 'skill_assignment' as const;
const NO_VALID_TARGETS_REASON = 'no valid assignment targets';

/**
 * Agent-initiated suggestions carry no self-reported confidence signal.
 * `inference` (not struggle-derived) already caps how far governance will
 * let a `skill_assignment` proposal go (see `ImprovementGovernancePolicy`);
 * the fixed default mirrors `create_skill_proposal`'s
 * (`CREATE_SKILL_PROPOSAL_DEFAULT_CONFIDENCE`).
 */
const SUGGEST_SKILL_ASSIGNMENT_DEFAULT_CONFIDENCE = 0.5;

export const suggestSkillAssignmentSchema = z.object({
  skill_name: z.string().min(1).max(128),
  targets: z.array(assignmentTargetSchema).min(1),
  rationale: z.string().max(2000).optional(),
});

type SuggestSkillAssignmentParams = z.infer<
  typeof suggestSkillAssignmentSchema
>;

/**
 * Pure handler: builds a `skill_assignment` improvement-proposal draft from
 * an agent's `suggest_skill_assignment` tool call and files it through
 * `ImprovementProposalService.submitProposal` — GOVERNED, exactly like
 * `create_skill_proposal`. This tool never assigns a skill directly; only
 * `SkillAssignmentApplier` binds `assignment_targets` to their destinations,
 * and only once governance clears the resulting proposal.
 *
 * Structural target validation is delegated to the Epic B1
 * `parseAssignmentTargets` helper (silently drops malformed entries). If
 * every supplied target is malformed, the call is rejected up front and
 * `submitProposal` is never reached.
 */
export async function handleSuggestSkillAssignment(
  params: SuggestSkillAssignmentParams,
  context: SuggestSkillAssignmentContext,
  service: SuggestSkillAssignmentProposalService,
): Promise<SuggestSkillAssignmentResult> {
  const targets = parseAssignmentTargets(params.targets);
  if (targets.length === 0) {
    return {
      status: 'rejected',
      proposalId: null,
      created: false,
      reason: NO_VALID_TARGETS_REASON,
    };
  }

  const provenance: Record<string, unknown> = {
    tool: SUGGEST_SKILL_ASSIGNMENT_SOURCE_TOOL,
  };
  if (context.runId) {
    provenance.runId = context.runId;
  }
  if (context.agentProfileName) {
    provenance.agentProfileName = context.agentProfileName;
  }

  const result = await service.submitProposal({
    kind: IMPROVEMENT_KIND_SKILL_ASSIGNMENT,
    payload: {
      skillName: params.skill_name,
      assignment_targets: targets,
      ...(params.rationale ? { rationale: params.rationale } : {}),
    },
    evidence: { evidenceClass: 'inference' },
    confidence: SUGGEST_SKILL_ASSIGNMENT_DEFAULT_CONFIDENCE,
    provenance,
  });

  if (result.proposal === null) {
    return { status: 'dropped', proposalId: null, created: false };
  }

  // `submitProposal` only ever pairs a non-null `proposal` with
  // 'auto_applied' | 'proposed' | 'apply_failed' — 'dropped' always
  // carries `proposal: null` (handled above).
  return {
    status: result.outcome as 'auto_applied' | 'proposed' | 'apply_failed',
    proposalId: result.proposal.id,
    created: true,
  };
}

@Injectable()
export class SuggestSkillAssignmentTool implements IInternalToolHandler<
  SuggestSkillAssignmentParams,
  SuggestSkillAssignmentResult
> {
  constructor(
    private readonly improvementProposals: ImprovementProposalService,
  ) {}

  getName(): string {
    return 'suggest_skill_assignment';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'context'],
      description:
        'Suggest assigning an existing skill to an agent profile or workflow step. Files a governed improvement proposal — never assigns directly.',
      apiCallback: {
        method: 'POST',
        pathTemplate:
          '/api/workflow-runtime/learning/proposals/suggest-assignment',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          skill_name: 'skill_name',
          targets: 'targets',
          rationale: 'rationale',
        },
      },
      inputSchema: suggestSkillAssignmentSchema,
    };
  }

  execute(
    context: InternalToolExecutionContext,
    params: SuggestSkillAssignmentParams,
  ): Promise<SuggestSkillAssignmentResult> {
    return handleSuggestSkillAssignment(
      params,
      {
        runId: context.workflowRunId,
        agentProfileName: context.agentProfileName,
      },
      this.improvementProposals,
    );
  }
}
