import type {
  ImprovementProposalDraft,
  SubmitProposalResult,
} from '../../../improvement/improvement-proposal.service.types';
import type { ImprovementProposal } from '../../../improvement/database/entities/improvement-proposal.entity';
import type { CreateSkillProposalDraftParams } from './create-skill-proposal.handler.types';

const IMPROVEMENT_KIND_SKILL_CREATE = 'skill_create' as const;
const CREATE_SKILL_PROPOSAL_SOURCE_TOOL = 'create_skill_proposal';
/**
 * Agent-initiated `create_skill_proposal` calls carry no self-reported
 * confidence. `inference` (not struggle-derived) caps confidence well below
 * the 0.5 promotion floor (see `RETROSPECTIVE_ROUTER_SETTING_DEFAULTS.inferenceCap`),
 * so this default plays no role in whether the proposal auto-applies — it is
 * always subject to `ImprovementGovernancePolicy`.
 */
const CREATE_SKILL_PROPOSAL_DEFAULT_CONFIDENCE = 0.5;

/**
 * Build the `skill_create` improvement-proposal draft for an agent-initiated
 * `create_skill_proposal` tool call — GOVERNED (unlike the learning-promotion
 * skill route, which bypasses governance because `PromotionGovernancePolicy`
 * already gated it upstream). `evidenceClass` is always `inference`: an
 * agent's free-form proposal carries no run-level struggle signal to derive
 * `struggle_backed` from.
 */
export function buildCreateSkillProposalDraft(
  candidateId: string,
  params: CreateSkillProposalDraftParams,
): ImprovementProposalDraft {
  return {
    kind: IMPROVEMENT_KIND_SKILL_CREATE,
    payload: {
      target_skill_name: params.target_skill_name,
      proposal_title: params.proposal_title,
      proposal_summary: params.proposal_summary,
      patch_markdown: params.patch_markdown,
      assignment_targets: [],
      ...(params.rationale ? { rationale: params.rationale } : {}),
    },
    evidence: { evidenceClass: 'inference' },
    confidence: CREATE_SKILL_PROPOSAL_DEFAULT_CONFIDENCE,
    provenance: {
      learning_candidate_id: candidateId,
      source_tool: CREATE_SKILL_PROPOSAL_SOURCE_TOOL,
    },
  };
}

/** Map `ImprovementProposalService.submitProposal`'s result onto the tool's agent-facing contract. */
export function toCreateSkillProposalResult(
  result: SubmitProposalResult,
): Record<string, unknown> {
  if (result.proposal === null) {
    return { proposal_id: null, status: 'dropped', created: false };
  }
  return {
    proposal_id: result.proposal.id,
    status: result.proposal.status,
    created: true,
  };
}

/**
 * Map an already-pending `skill_create` proposal onto the same agent-facing
 * contract as {@link toCreateSkillProposalResult}, for the idempotent
 * `create_skill_proposal` path: repeated tool calls for the same
 * `target_skill_name` resolve to the existing pending proposal (`created:
 * false`) instead of submitting a duplicate.
 */
export function toExistingSkillProposalResult(
  existing: ImprovementProposal,
): Record<string, unknown> {
  return {
    proposal_id: existing.id,
    status: existing.status,
    created: false,
  };
}
