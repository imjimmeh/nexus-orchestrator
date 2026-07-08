/**
 * Pure helpers for the `agent_profile_change` / `workflow_definition_change`
 * routing branches (EPIC-D Task 8). Split out of
 * `retrospective-output-router.service.ts` to keep that file under the
 * project's file-length cap.
 *
 * Both definition-change kinds share the same evidence and provenance
 * shape, derived from the SAME run-level struggle-backing signal the router
 * already uses to cap confidence (see `deriveRetrospectiveConfidence` /
 * `routeSkillProposal` in the service) — a struggle-backed finding is
 * `struggle_backed`, everything else is `inference`. `ledgerRefs` mirrors the
 * finding's cited event ids and is omitted entirely (never an empty array)
 * when the finding cites none, matching the existing skill-proposal evidence
 * shape.
 */
import type {
  ImprovementEvidenceClass,
  RetrospectiveFinding,
} from '@nexus/core';
import type { ImprovementEvidencePayload } from '../../improvement/database/entities/improvement-proposal.entity.types';
import type { DefinitionChangeProvenance } from './retrospective-output-router.definition-changes.helpers.types';

export type { DefinitionChangeProvenance };

const EVIDENCE_CLASS_STRUGGLE: ImprovementEvidenceClass = 'struggle_backed';
const EVIDENCE_CLASS_INFERENCE: ImprovementEvidenceClass = 'inference';
/** The provenance `source` tag every router-born definition-change proposal carries. */
const PROVENANCE_SOURCE = 'retrospective_analyst' as const;

/**
 * Build the `ImprovementEvidencePayload` for a routed `agent_profile_change`
 * / `workflow_definition_change` finding.
 */
export function buildDefinitionChangeEvidence(
  finding: RetrospectiveFinding,
  originalRunId: string,
  struggleBacked: boolean,
): ImprovementEvidencePayload {
  return {
    evidenceClass: struggleBacked
      ? EVIDENCE_CLASS_STRUGGLE
      : EVIDENCE_CLASS_INFERENCE,
    runIds: [originalRunId],
    ...(finding.evidence_event_ids.length > 0
      ? { ledgerRefs: finding.evidence_event_ids }
      : {}),
  };
}

/** Build the proposal provenance for a router-born definition-change proposal. */
export function buildDefinitionChangeProvenance(
  originalRunId: string,
): DefinitionChangeProvenance {
  return { source: PROVENANCE_SOURCE, original_run_id: originalRunId };
}
