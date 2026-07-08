/**
 * `RetrospectiveOutputRouter` — EPIC-212 Phase-2 Task 7.
 *
 * The single place analyst hallucination is neutralized. The analysis
 * orchestrator (Task 6) hands each surviving, evidence-backed, not-already-known
 * finding to this router via the {@link RetrospectiveRouterPort}. The router —
 * NOT the analyst — decides confidence and the birth path:
 *
 *   1. RE-DERIVE CONFIDENCE (ignore `finding.confidence_self`). Confidence is a
 *      HARD CAP keyed on the EVIDENCE CLASS, derived deterministically at run
 *      level: if the original run exhibited at least one real failed→recovered
 *      struggle span (`StruggleDetectorService.detect(runId).length > 0`) the
 *      finding is "struggle-backed" and capped at the struggle cap (0.7);
 *      otherwise it is "pure inference" and capped at the inference cap (0.45 —
 *      below the 0.5 promotion floor, so it can NEVER auto-promote without
 *      human approval). The port input carries no per-finding struggle flag, so
 *      deriving struggle-backing once at run level is the chosen, defensible
 *      heuristic.
 *
 *   2. ROUTE BY KIND.
 *      - `memory` → `RecordLearningService.recordLearning(...)`, reusing the
 *        EXISTING record_learning → sweep → promote pipeline (incl. the
 *        pending>=10 auto-sweep).
 *      - `skill_proposal` → an improvement proposal via
 *        `ImprovementProposalService.submitProposal`; the improvement pipeline's
 *        own governance decides whether it is proposed or auto-applied. The
 *        router — never the analyst — decides the proposal KIND too: if the
 *        recommended skill name already exists (`AgentSkillsService.skillExists`),
 *        a `skill_create` for it would be a near-duplicate, so the router files a
 *        `skill_assignment` instead (bind the EXISTING skill to the suggested
 *        targets); only a genuinely new skill name gets `skill_create`. Either
 *        way, the analyst's optional `assignment_targets` are re-validated via
 *        `parseAssignmentTargets` (Epic B1) before they reach the proposal
 *        payload — malformed entries are dropped, never trusted verbatim.
 *      - `none` → no-op (defensive; Task 6 already drops these).
 *
 *   3. CREDENTIAL RAIL (HARD). Before routing, secret-shaped VALUES are REDACTED
 *      from the lesson / root_cause / fix / working_procedure (value-level, so
 *      the durable lesson survives while the secret value never persists). A
 *      finding that carried a secret value is forced to PROJECT scope and never
 *      routes global. CHOICE = redact (not reject): the lesson "set
 *      password=[REDACTED] in config" stays useful; only the value is stripped.
 *
 * Fail-soft: a routing error for one finding is logged + swallowed so it can
 * never abort the remaining findings (the orchestrator additionally guards each
 * call). Scope-neutral: only the neutral `scopeId` flows through.
 */
import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  ImprovementEvidenceClass,
  RetrospectiveFinding,
} from '@nexus/core';
import {
  AgentProfileChangePayloadSchema,
  WorkflowDefinitionChangePayloadSchema,
} from '@nexus/core';
import { RecordLearningService } from '../../memory/learning/record-learning.service';
import { ImprovementProposalService } from '../../improvement/improvement-proposal.service';
import type { ImprovementEvidencePayload } from '../../improvement/database/entities/improvement-proposal.entity.types';
import { parseAssignmentTargets } from '../../improvement/appliers/assignment-target.helpers';
import { StruggleDetectorService } from '../../memory/signals/struggle-detector.service';
import { redactSecretValues } from '../../memory/signals/credential-signal.helper';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { AgentSkillsService } from '../../ai-config/services/agent-skills.service';
import { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';
import { WorkflowRunRepository } from '../database/repositories/workflow-run.repository';
import { WorkflowRepository } from '../database/repositories/workflow.repository';
import { resolveWorkflowNameForRun } from '../workflow-run-name-resolver.helpers';
import {
  RETROSPECTIVE_ROUTER_SETTING_DEFAULTS,
  RETROSPECTIVE_ROUTER_SETTING_KEYS,
} from './retrospective-router.settings.constants';
import {
  buildDefinitionChangeEvidence,
  buildDefinitionChangeProvenance,
} from './retrospective-output-router.definition-changes.helpers';
import type {
  RetrospectiveRouteInput,
  RetrospectiveRouteResult,
} from './retrospective-router.types';

/** A stable synthetic job id attributing router-born candidates/proposals. */
const SYNTHETIC_JOB_ID = 'retrospective_analyst';
/** Marks the analyst as the source tool of the candidate. */
const SOURCE_TOOL = 'retrospective_analyst';
/** The candidate type for router-born learning candidates. */
const CANDIDATE_TYPE = 'retrospective';
/** Evidence `kind` for cited `event_ledger` rows. */
const EVIDENCE_KIND = 'event_ledger';
/** Evidence `kind` for the run-level fallback when no event ids are cited. */
const EVIDENCE_RUN_KIND = 'run';
const EVIDENCE_SUMMARY = 'retrospective analyst evidence';
/** Base tag every router-born candidate carries. */
const TAG_BASE = 'retrospective_analyst';
const TAG_STRUGGLE_BACKED = 'struggle_backed';
const TAG_INFERENCE = 'inference';
const TAG_CREDENTIAL_RAIL = 'credential_rail';
/** Scope types the router emits. `global` is NEVER self-elected here. */
const SCOPE_PROJECT = 'project';
const SCOPE_AGENT = 'agent';
const SCOPE_WORKFLOW = 'workflow';
const SCOPE_HINT_AGENT_PREFERENCE = 'agent_preference';
const SCOPE_HINT_WORKFLOW_SPECIFIC = 'workflow_specific';
/** Evidence classes for a routed skill proposal (struggle-backed vs inference). */
const EVIDENCE_CLASS_STRUGGLE: ImprovementEvidenceClass = 'struggle_backed';
const EVIDENCE_CLASS_INFERENCE: ImprovementEvidenceClass = 'inference';
const IMPROVEMENT_KIND_SKILL_CREATE = 'skill_create' as const;
const IMPROVEMENT_KIND_SKILL_ASSIGNMENT = 'skill_assignment' as const;
const IMPROVEMENT_KIND_AGENT_PROFILE_CHANGE = 'agent_profile_change' as const;
const IMPROVEMENT_KIND_WORKFLOW_DEFINITION_CHANGE =
  'workflow_definition_change' as const;
const PROPOSAL_FALLBACK_SLUG = 'retrospective-skill';
/** Length (hex chars) of the short hash appended to a fallback slug (FU-17). */
const FALLBACK_SLUG_HASH_LENGTH = 8;
const SKILL_SLUG_MAX_LENGTH = 120;
const PROPOSAL_TITLE_MAX_LENGTH = 220;
/** Route-result reason code: an unhandled error was thrown while routing. */
const REASON_ROUTER_ERROR = 'router_error';
/** Route-result reason code: the finding's `kind` has no dispatch branch. */
const REASON_KIND_UNROUTABLE = 'kind_unroutable';
/** Route-result reason code: the finding's definition-change payload failed re-validation. */
const REASON_PAYLOAD_INVALID = 'payload_invalid';
/** Route-result reason code: the definition-change target (profile/workflow) does not exist. */
const REASON_TARGET_NOT_FOUND = 'target_not_found';

/** Resolved confidence ceilings (one read per routing pass). */
interface ConfidenceCaps {
  struggleCap: number;
  inferenceCap: number;
}

/** Per-finding sanitized fields + whether a secret value was stripped. */
interface CredentialRailResult {
  lesson: string;
  fix: string | undefined;
  workingProcedure: string | undefined;
  credentialBearing: boolean;
}

/** The fully resolved routing context shared by the per-kind dispatchers. */
interface RouteContext {
  finding: RetrospectiveFinding;
  scopeId: string | null;
  originalRunId: string;
  rail: CredentialRailResult;
  struggleBacked: boolean;
  confidence: number;
}

@Injectable()
export class RetrospectiveOutputRouter {
  private readonly logger = new Logger(RetrospectiveOutputRouter.name);

  constructor(
    private readonly recordLearning: RecordLearningService,
    private readonly improvementProposals: ImprovementProposalService,
    private readonly struggleDetector: StruggleDetectorService,
    private readonly settings: SystemSettingsService,
    private readonly agentSkills: AgentSkillsService,
    private readonly runRepo: WorkflowRunRepository,
    private readonly workflowRepo: WorkflowRepository,
    private readonly agentProfiles: AgentProfileRepository,
  ) {}

  /**
   * Re-derive confidence and route one finding. Fail-soft: a `none` finding is
   * a defensive no-op (Task 6 already drops these upstream) that still reports
   * `routed` so the caller never mistakes it for a failure; any thrown error
   * is logged and reported back as `{ outcome: 'dropped', reasonCode:
   * 'router_error' }` instead of being swallowed silently, so the caller can
   * emit an honest rejection event.
   */
  async route(
    input: RetrospectiveRouteInput,
  ): Promise<RetrospectiveRouteResult> {
    const { finding, scopeId, originalRunId } = input;
    if (finding.kind === 'none') {
      return { outcome: 'routed' };
    }
    try {
      const rail = applyCredentialRail(finding);
      const struggleBacked = await this.isStruggleBacked(originalRunId);
      const caps = await this.resolveCaps();
      const confidence = deriveRetrospectiveConfidence(
        struggleBacked,
        caps.struggleCap,
        caps.inferenceCap,
      );
      return await this.dispatchByKind({
        finding,
        scopeId,
        originalRunId,
        rail,
        struggleBacked,
        confidence,
      });
    } catch (error) {
      this.warn(`route failed for run ${originalRunId}`, error);
      return {
        outcome: 'dropped',
        reasonCode: REASON_ROUTER_ERROR,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async dispatchByKind(
    ctx: RouteContext,
  ): Promise<RetrospectiveRouteResult> {
    switch (ctx.finding.kind) {
      case 'memory':
        await this.routeMemory(ctx);
        return { outcome: 'routed' };
      case 'skill_proposal':
        await this.routeSkillProposal(ctx);
        return { outcome: 'routed' };
      case 'agent_profile_change':
        return this.routeAgentProfileChange(ctx);
      case 'workflow_definition_change':
        return this.routeWorkflowDefinitionChange(ctx);
      default:
        return { outcome: 'dropped', reasonCode: REASON_KIND_UNROUTABLE };
    }
  }

  // ── memory → record_learning pipeline ─────────────────────────────────────

  private async routeMemory(ctx: RouteContext): Promise<void> {
    const { finding, scopeId, originalRunId, rail, struggleBacked } = ctx;
    const scope = await this.resolveMemoryScope(
      finding,
      rail,
      scopeId,
      originalRunId,
    );
    const tags = buildTags(struggleBacked, rail.credentialBearing);

    await this.recordLearning.recordLearning(
      {
        workflowRunId: originalRunId,
        jobId: SYNTHETIC_JOB_ID,
        scopeId,
      },
      {
        scope_type: scope.scopeType,
        scope_id: scope.scopeId,
        lesson: rail.lesson,
        evidence: buildEvidence(finding.evidence_event_ids, originalRunId),
        confidence: ctx.confidence,
        tags,
      },
      {
        candidateType: CANDIDATE_TYPE,
        sourceTool: SOURCE_TOOL,
        sourceQualityConfidence: ctx.confidence,
      },
    );
  }

  /**
   * Map the hint to a concrete (scope_type, scope_id). `workflow_specific`
   * resolves the original run's workflow definition name; when unresolvable it
   * degrades to project scope (never dropped, never global). Credential-bearing
   * findings were already forced to project by `resolveScopeType` above the
   * workflow branch, so a secret-bearing `workflow_specific` finding never
   * reaches the workflow lookup at all (Epic C rail preserved).
   */
  private async resolveMemoryScope(
    finding: RetrospectiveFinding,
    rail: CredentialRailResult,
    scopeId: string | null,
    originalRunId: string,
  ): Promise<{ scopeType: string; scopeId: string | null }> {
    const scopeType = resolveScopeType(
      finding.scope_hint,
      rail.credentialBearing,
    );
    if (scopeType !== SCOPE_WORKFLOW) {
      return { scopeType, scopeId };
    }
    const workflowName = await resolveWorkflowNameForRun(
      this.runRepo,
      this.workflowRepo,
      originalRunId,
      (message) => {
        this.logger.warn(message);
      },
    );
    return workflowName
      ? { scopeType: SCOPE_WORKFLOW, scopeId: workflowName }
      : { scopeType: SCOPE_PROJECT, scopeId };
  }

  // ── skill_proposal → skill_create / skill_assignment improvement proposal ──

  /**
   * Route a `skill_proposal` finding onto the improvement pipeline.
   * `evidenceClass` is derived deterministically from the router's own
   * run-level struggle-backing signal — the SAME signal that caps confidence
   * above (struggle-backed → 0.7, pure inference → 0.45). There is no
   * ambiguity here: a struggle-backed finding is `struggle_backed`, everything
   * else is `inference`. The cited `evidence_event_ids` flow through as
   * `ledgerRefs` and the original run as `runIds`.
   *
   * The router — not the analyst — decides the proposal KIND: a `skill_create`
   * for a name that already exists would be a near-duplicate skill, so an
   * existing skill instead gets a `skill_assignment` (bind it to the
   * suggested targets). Either way, `finding.assignment_targets` (the
   * analyst's optional, non-binding suggestion) is re-validated via
   * `parseAssignmentTargets` before it reaches the payload — a hallucinated or
   * malformed target entry is dropped, never trusted verbatim.
   */
  private async routeSkillProposal(ctx: RouteContext): Promise<void> {
    const { rail, originalRunId, finding, struggleBacked, confidence } = ctx;
    const skillName = deriveSkillSlug(rail.workingProcedure ?? rail.lesson);
    const assignmentTargets = parseAssignmentTargets(
      finding.assignment_targets,
    );

    const evidence: ImprovementEvidencePayload = {
      evidenceClass: struggleBacked
        ? EVIDENCE_CLASS_STRUGGLE
        : EVIDENCE_CLASS_INFERENCE,
      runIds: [originalRunId],
      ...(finding.evidence_event_ids.length > 0
        ? { ledgerRefs: finding.evidence_event_ids }
        : {}),
    };

    await this.improvementProposals.submitProposal({
      ...(this.agentSkills.skillExists(skillName)
        ? {
            kind: IMPROVEMENT_KIND_SKILL_ASSIGNMENT,
            payload: { skillName, assignment_targets: assignmentTargets },
          }
        : {
            kind: IMPROVEMENT_KIND_SKILL_CREATE,
            payload: {
              target_skill_name: skillName,
              proposal_title: truncate(rail.lesson, PROPOSAL_TITLE_MAX_LENGTH),
              proposal_summary: rail.lesson,
              patch_markdown: rail.workingProcedure ?? rail.fix ?? rail.lesson,
              assignment_targets: assignmentTargets,
            },
          }),
      evidence,
      confidence,
      provenance: { scope_id: ctx.scopeId, source_run_id: originalRunId },
    });
  }

  // ── agent_profile_change / workflow_definition_change → governed proposal ─

  /**
   * Route an `agent_profile_change` finding onto the governed improvement
   * pipeline. Re-validates `finding.profile_change` (defensive — the
   * analysis orchestrator's schema parse upstream normally already caught a
   * malformed payload) and confirms the target profile still exists BEFORE
   * submitting, so a hallucinated or stale profile name drops with an honest
   * `target_not_found` ledger note (via the caller's rejection seam) instead
   * of reaching `ImprovementProposalService`. Governance (auto-apply vs
   * propose vs drop) is entirely `submitProposal`'s job, not the router's.
   */
  private async routeAgentProfileChange(
    ctx: RouteContext,
  ): Promise<RetrospectiveRouteResult> {
    const parsed = AgentProfileChangePayloadSchema.safeParse(
      ctx.finding.profile_change,
    );
    if (!parsed.success) {
      return {
        outcome: 'dropped',
        reasonCode: REASON_PAYLOAD_INVALID,
        detail: parsed.error.message,
      };
    }
    const payload = parsed.data;
    const profile = await this.agentProfiles.findByName(payload.profileName);
    if (!profile) {
      return {
        outcome: 'dropped',
        reasonCode: REASON_TARGET_NOT_FOUND,
        detail: `agent_profile_change target "${payload.profileName}" does not exist`,
      };
    }

    await this.improvementProposals.submitProposal({
      kind: IMPROVEMENT_KIND_AGENT_PROFILE_CHANGE,
      payload,
      confidence: ctx.confidence,
      evidence: buildDefinitionChangeEvidence(
        ctx.finding,
        ctx.originalRunId,
        ctx.struggleBacked,
      ),
      provenance: buildDefinitionChangeProvenance(ctx.originalRunId),
    });
    return { outcome: 'routed' };
  }

  /**
   * Route a `workflow_definition_change` finding onto the governed
   * improvement pipeline. Mirrors {@link routeAgentProfileChange}: re-validate
   * `finding.workflow_change`, confirm the target workflow still exists (by
   * id or name, inactive workflows included — the same identifier resolution
   * `WorkflowDefinitionChangeApplier` uses at apply time), then submit.
   */
  private async routeWorkflowDefinitionChange(
    ctx: RouteContext,
  ): Promise<RetrospectiveRouteResult> {
    const parsed = WorkflowDefinitionChangePayloadSchema.safeParse(
      ctx.finding.workflow_change,
    );
    if (!parsed.success) {
      return {
        outcome: 'dropped',
        reasonCode: REASON_PAYLOAD_INVALID,
        detail: parsed.error.message,
      };
    }
    const payload = parsed.data;
    const identifier = payload.workflowId ?? payload.workflowName;
    if (identifier === undefined) {
      return {
        outcome: 'dropped',
        reasonCode: REASON_PAYLOAD_INVALID,
        detail:
          'workflow_definition_change payload has neither workflowId nor workflowName',
      };
    }
    const workflow = await this.workflowRepo.findByIdentifier(identifier, {
      includeInactive: true,
    });
    if (!workflow) {
      return {
        outcome: 'dropped',
        reasonCode: REASON_TARGET_NOT_FOUND,
        detail: `workflow_definition_change target "${identifier}" does not exist`,
      };
    }

    await this.improvementProposals.submitProposal({
      kind: IMPROVEMENT_KIND_WORKFLOW_DEFINITION_CHANGE,
      payload,
      confidence: ctx.confidence,
      evidence: buildDefinitionChangeEvidence(
        ctx.finding,
        ctx.originalRunId,
        ctx.struggleBacked,
      ),
      provenance: buildDefinitionChangeProvenance(ctx.originalRunId),
    });
    return { outcome: 'routed' };
  }

  // ── Struggle backing (run-level heuristic) ────────────────────────────────

  /**
   * True when the original run exhibited at least one real failed→recovered
   * struggle span. Fail-soft: a detection error is treated as pure inference
   * (the lower, safer cap) — never the higher struggle cap.
   */
  private async isStruggleBacked(runId: string): Promise<boolean> {
    try {
      const spans = await this.struggleDetector.detect(runId);
      return spans.length > 0;
    } catch (error) {
      this.warn(
        `struggle detection failed for run ${runId} (treating as inference)`,
        error,
      );
      return false;
    }
  }

  private async resolveCaps(): Promise<ConfidenceCaps> {
    return {
      struggleCap: await this.readNumber(
        RETROSPECTIVE_ROUTER_SETTING_KEYS.struggleCap,
        RETROSPECTIVE_ROUTER_SETTING_DEFAULTS.struggleCap,
      ),
      inferenceCap: await this.readNumber(
        RETROSPECTIVE_ROUTER_SETTING_KEYS.inferenceCap,
        RETROSPECTIVE_ROUTER_SETTING_DEFAULTS.inferenceCap,
      ),
    };
  }

  private async readNumber(key: string, fallback: number): Promise<number> {
    try {
      return await this.settings.get<number>(key, fallback);
    } catch {
      return fallback;
    }
  }

  private warn(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `RetrospectiveOutputRouter ${context}: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

// ── Pure helpers (unit-tested directly) ──────────────────────────────────────

/**
 * Re-derive a finding's confidence from its evidence class. The analyst's
 * self-reported `confidence_self` is IGNORED entirely — this is the hallucination
 * neutralizer. The result is a HARD CAP: a struggle-backed finding is capped at
 * `struggleCap`; a pure-inference finding at `inferenceCap` (which sits below the
 * 0.5 promotion floor, so it can never auto-promote without human approval).
 */
export function deriveRetrospectiveConfidence(
  struggleBacked: boolean,
  struggleCap: number,
  inferenceCap: number,
): number {
  const cap = struggleBacked ? struggleCap : inferenceCap;
  return Math.max(0, Math.min(cap, 1));
}

/**
 * Apply the credential rail across every textual field. Scans lesson,
 * root_cause, fix, and working_procedure for secret VALUES; redacts them; and
 * flags the finding as credential-bearing if any field carried a secret (which
 * forces project scope downstream). Only the fields persisted downstream
 * (lesson, fix, working_procedure) are returned sanitized; root_cause is
 * scanned for the flag but not persisted.
 */
function applyCredentialRail(
  finding: RetrospectiveFinding,
): CredentialRailResult {
  const lesson = redactSecretValues(finding.lesson);
  const rootCause = redactSecretValues(finding.root_cause ?? '');
  const fix =
    finding.fix === undefined ? undefined : redactSecretValues(finding.fix);
  const workingProcedure =
    finding.working_procedure === undefined
      ? undefined
      : redactSecretValues(finding.working_procedure);

  const credentialBearing =
    lesson.redacted ||
    rootCause.redacted ||
    (fix?.redacted ?? false) ||
    (workingProcedure?.redacted ?? false);

  return {
    lesson: lesson.text,
    fix: fix?.text,
    workingProcedure: workingProcedure?.text,
    credentialBearing,
  };
}

/**
 * Map the analyst's NON-binding `scope_hint` to a concrete scope type. A
 * credential-bearing finding is forced to project (never global). The `global`
 * hint is NEVER self-elected here — cross-scope `global` routing is the
 * deterministic `LearningRouterService`'s job (Task 8); until then the analyst
 * cannot birth a global candidate, so global memory can never auto-promote.
 */
function resolveScopeType(
  scopeHint: RetrospectiveFinding['scope_hint'],
  credentialBearing: boolean,
): string {
  if (credentialBearing) {
    return SCOPE_PROJECT;
  }
  if (scopeHint === SCOPE_HINT_AGENT_PREFERENCE) {
    return SCOPE_AGENT;
  }
  if (scopeHint === SCOPE_HINT_WORKFLOW_SPECIFIC) {
    return SCOPE_WORKFLOW;
  }
  return SCOPE_PROJECT;
}

function buildTags(
  struggleBacked: boolean,
  credentialBearing: boolean,
): string[] {
  const tags = [TAG_BASE, struggleBacked ? TAG_STRUGGLE_BACKED : TAG_INFERENCE];
  if (credentialBearing) {
    tags.push(TAG_CREDENTIAL_RAIL);
  }
  return tags;
}

/**
 * Build evidence entries from the finding's cited event ids. Falls back to a
 * single run-level reference when the finding cites no event ids so the
 * record_learning evidence set is never empty.
 */
function buildEvidence(
  eventIds: string[],
  runId: string,
): Array<{ kind: string; id: string; summary: string }> {
  if (eventIds.length === 0) {
    return [{ kind: EVIDENCE_RUN_KIND, id: runId, summary: EVIDENCE_SUMMARY }];
  }
  return eventIds.map((id) => ({
    kind: EVIDENCE_KIND,
    id,
    summary: EVIDENCE_SUMMARY,
  }));
}

/**
 * Derive a kebab-case skill slug from a source string. A source that is
 * empty or entirely non-alphanumeric (e.g. a blank or symbols-only working
 * procedure/lesson) sanitizes to an empty slug; rather than always falling
 * back to the SAME `retrospective-skill` name (which would collide two
 * unrelated findings onto one skill and route the second as a
 * `skill_assignment` onto an unrelated existing skill), the fallback is made
 * unique by appending a short hash of the original source text.
 */
export function deriveSkillSlug(source: string): string {
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SKILL_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  if (slug.length > 0) {
    return slug;
  }
  const hash = createHash('sha256')
    .update(source)
    .digest('hex')
    .slice(0, FALLBACK_SLUG_HASH_LENGTH);
  return `${PROPOSAL_FALLBACK_SLUG}-${hash}`;
}

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}
