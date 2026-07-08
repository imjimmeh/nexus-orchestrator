/**
 * `LearningRouterService` — EPIC-212 Phase-2 Task 8.
 *
 * Decides each learning candidate's deterministic scope HOME before the sweep /
 * promotion ever sees it. Pure, cheap, deterministic signals run first and
 * short-circuit in safety order; the LLM is invoked ONLY to break a genuine
 * scope tie (currently a documented stub — see {@link arbitrateTie}).
 *
 * Decision order (each a small pure predicate to stay under the complexity cap):
 *   1. CREDENTIAL / CONNECTION signal → `project`, pinned. HARD safety rail,
 *      first — a credential fact NEVER routes `global` and its secret value
 *      never enters the routing signals (only a boolean flag does).
 *   2. TEMPLATED / low-signal noise → `drop` (reuses `TemplateNoiseClassifier`).
 *   3. WORKFLOW-scoped capture (`scope_type === 'workflow'`) → `workflow`,
 *      preserving its workflow-definition home (Epic C). Never rewritten to
 *      `project` by the scope-diversity pass below.
 *   4. BEHAVIOURAL always/never concentrated on ONE agent profile →
 *      `agent_preference`.
 *   5. REUSABLE multi-step procedure → `skill_patch` if it refines an existing
 *      skill (vector/lexical similarity above the Phase-1 threshold) else
 *      `skill_new`.
 *   6. CROSS-SCOPE truth (recurs across ≥ `learning_router_global_min_scopes`
 *      distinct scopes, or already global-scoped) → `global`; single-scope →
 *      `project`.
 *   7. Ambiguous scope (between single and the global threshold) → bounded
 *      LLM arbitration → the SAFEST deterministic target (never `global`).
 *
 * Fail-soft: any error degrades to `project` (the safe default) and never
 * throws out of `route` — so the nightly clusterer chain can never abort.
 *
 * ## Distinct-scope-count derivation (documented signal source)
 * The clusterer collapses near-duplicate candidates into one canonical row with
 * `recurrence_count = cluster size` but does NOT yet record the SET of scopes a
 * cluster spans. So this router reads the distinct-scope count, in precedence:
 *   1. `signals_json.distinct_scope_count` (explicit number), else
 *   2. `signals_json.cluster_scopes` (string[] of scope ids → distinct size), else
 *   3. `1` (single scope — the SAFE default that never over-routes to global).
 * A `scope_type === 'global'` candidate routes `global` directly.
 * CARRY-FORWARD: have the clusterer populate `cluster_scopes`/
 * `distinct_scope_count` on the canonical candidate so cross-scope global
 * routing fires end-to-end in production.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CANDIDATE_SIMILARITY } from '../signals/candidate-similarity.interface';
import type { ICandidateSimilarity } from '../signals/candidate-similarity.interface';
import { CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT } from '../signals/candidate-similarity.config';
import { TemplateNoiseClassifier } from '../signals/template-noise.classifier';
import { containsCredentialSignal } from '../signals/credential-signal.helper';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { SkillService } from '../../ai-config/services/skill.service';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import {
  LEARNING_ROUTER_SETTING_DEFAULTS,
  LEARNING_ROUTER_SETTING_KEYS,
} from './learning-router.settings.constants';
import type { RoutingDecision, RoutingTarget } from './learning-router.types';

export type { RoutingDecision, RoutingTarget } from './learning-router.types';

// ── Module constants ──────────────────────────────────────────────────────────

const GLOBAL_SCOPE_TYPE = 'global';
const WORKFLOW_SCOPE_TYPE = 'workflow';
const AGENT_SCOPE_TYPE = 'agent';
const SKILL_OWNER_TYPE = 'skill';
const SKILL_MATCH_K = 5;
const SKILL_MATCH_THRESHOLD = CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT;
/** The safest target a tie or error can ever resolve to — never `global`. */
const SAFE_DEFAULT_TARGET: RoutingTarget = 'project';

const CONFIDENCE_CREDENTIAL = 0.95;
const CONFIDENCE_DROP = 0.9;
const CONFIDENCE_WORKFLOW = 0.85;
const CONFIDENCE_AGENT = 0.85;
const CONFIDENCE_SKILL = 0.8;
const CONFIDENCE_GLOBAL = 0.9;
const CONFIDENCE_PROJECT = 0.85;
const CONFIDENCE_TIE = 0.4;
const CONFIDENCE_SAFE_DEFAULT = 0.5;

/** Detects ≥2 numbered steps (`1.`, `2)`) anywhere in the text. */
const NUMBERED_STEP_PATTERN = /(?:^|\s)\d+[.)]\s/g;
/** Sequencing words that, combined with steps, signal a multi-step procedure. */
const SEQUENCE_WORD_PATTERN =
  /\b(?:then|next|afterwards|finally|first|second|third)\b/gi;
/** Behavioural directive shape ("always …", "never …"). */
const BEHAVIOURAL_PATTERN = /\b(?:always|never)\b/i;

interface RouterSignals {
  credential: boolean;
  templateNoise: boolean;
  behavioural: boolean;
  agentProfile: string | null;
  distinctScopes: number;
  reusableProcedure: boolean;
}

@Injectable()
export class LearningRouterService {
  private readonly logger = new Logger(LearningRouterService.name);

  constructor(
    @Inject(CANDIDATE_SIMILARITY)
    private readonly similarity: ICandidateSimilarity,
    private readonly templateNoise: TemplateNoiseClassifier,
    private readonly settings: SystemSettingsService,
    private readonly skills: SkillService,
  ) {}

  /**
   * Route one candidate to its deterministic scope home. Fail-soft: any error
   * degrades to the safe `project` default and never throws.
   */
  async route(candidate: LearningCandidate): Promise<RoutingDecision> {
    try {
      const signals = gatherSignals(candidate, this.templateNoise);

      const credential = routeCredential(candidate, signals);
      if (credential) return credential;

      const drop = routeDrop(signals);
      if (drop) return drop;

      const workflowScope = routeWorkflowScope(candidate);
      if (workflowScope) return workflowScope;

      const agentScope = routeAgentScope(candidate);
      if (agentScope) return agentScope;

      const agent = routeAgentPreference(signals);
      if (agent) return agent;

      const skill = await this.routeSkill(candidate, signals);
      if (skill) return skill;

      const scope = await this.routeScopeDiversity(candidate, signals);
      if (scope) return scope;

      return await this.routeTieBreak(candidate, signals);
    } catch (error) {
      this.warn(candidate.id, error);
      return safeProjectDecision(
        candidate,
        'router error → safe project default',
      );
    }
  }

  // ── Skill routing (similarity-backed) ─────────────────────────────────────

  private async routeSkill(
    candidate: LearningCandidate,
    signals: RouterSignals,
  ): Promise<RoutingDecision | null> {
    if (!signals.reusableProcedure) {
      return null;
    }
    const match = await this.matchExistingSkill(candidate);
    const target: RoutingTarget = match.patch ? 'skill_patch' : 'skill_new';
    const rationale = match.patch
      ? `refines an existing skill (similarity ${match.score.toFixed(2)} ≥ ${SKILL_MATCH_THRESHOLD})`
      : 'reusable multi-step procedure → new skill proposal';
    return {
      target,
      scopeType: SKILL_OWNER_TYPE,
      scopeId: null,
      rationale,
      confidence: CONFIDENCE_SKILL,
      signals: { reusableProcedure: true, skillMatchScore: match.score },
    };
  }

  /**
   * True when the candidate's procedure is a near-duplicate of an existing
   * skill (→ `skill_patch`). Fail-soft: no skills / similarity error → treat as
   * a new skill (`patch:false`).
   */
  private async matchExistingSkill(
    candidate: LearningCandidate,
  ): Promise<{ patch: boolean; score: number }> {
    try {
      const corpus = await this.loadSkillCorpus();
      if (corpus.length === 0) {
        return { patch: false, score: 0 };
      }
      const neighbours = await this.similarity.findRawSimilarNeighbors(
        candidate.summary,
        SKILL_MATCH_K,
        {
          ownerType: SKILL_OWNER_TYPE,
          ownerIds: corpus.map((entry) => entry.ownerId),
          corpus,
        },
      );
      const top = neighbours.reduce(
        (best, neighbour) => (neighbour.score > best ? neighbour.score : best),
        0,
      );
      return { patch: top >= SKILL_MATCH_THRESHOLD, score: top };
    } catch (error) {
      this.warn(candidate.id, error);
      return { patch: false, score: 0 };
    }
  }

  private async loadSkillCorpus(): Promise<
    Array<{ ownerId: string; content: string }>
  > {
    const skills = await this.skills.list();
    return skills.map((skill) => ({
      ownerId: skill.id,
      content: `${skill.name} ${skill.description ?? ''}`.trim(),
    }));
  }

  // ── Scope-diversity routing ───────────────────────────────────────────────

  private async routeScopeDiversity(
    candidate: LearningCandidate,
    signals: RouterSignals,
  ): Promise<RoutingDecision | null> {
    const minScopes = await this.globalMinScopes();

    if (candidate.scope_type === GLOBAL_SCOPE_TYPE) {
      return globalDecision(
        signals.distinctScopes,
        'candidate already global-scoped → global',
      );
    }
    if (signals.distinctScopes >= minScopes) {
      return globalDecision(
        signals.distinctScopes,
        `cross-scope truth (${signals.distinctScopes.toString()} scopes ≥ ${minScopes.toString()}) → global`,
      );
    }
    if (signals.distinctScopes <= 1) {
      return {
        target: 'project',
        scopeType: 'project',
        scopeId: candidate.scopeId,
        rationale: 'single-scope fact → project',
        confidence: CONFIDENCE_PROJECT,
        signals: { distinctScopes: signals.distinctScopes },
      };
    }
    // 1 < distinctScopes < minScopes → low scope-confidence tie.
    return null;
  }

  // ── Tie-break (bounded, fail-soft LLM arbitration — currently stubbed) ─────

  private async routeTieBreak(
    candidate: LearningCandidate,
    signals: RouterSignals,
  ): Promise<RoutingDecision> {
    const target = await this.arbitrateTie(candidate, signals);
    return {
      target,
      scopeType: target === GLOBAL_SCOPE_TYPE ? GLOBAL_SCOPE_TYPE : 'project',
      scopeId: target === GLOBAL_SCOPE_TYPE ? null : candidate.scopeId,
      rationale: `low scope-confidence tie (${signals.distinctScopes.toString()} scopes) → arbitration → ${target}`,
      confidence: CONFIDENCE_TIE,
      signals: { distinctScopes: signals.distinctScopes, arbitrated: true },
    };
  }

  /**
   * Bounded scope arbitration seam. CARRY-FORWARD (Task 9/10): wire a single
   * cost-bounded, fail-soft LLM call here. Today it is a deterministic STUB
   * returning the SAFEST target (`project`, never `global`) so a tie can never
   * auto-escalate to global. A throw here is caught by {@link route} and also
   * degrades to the safe project default.
   */
  private async arbitrateTie(
    _candidate: LearningCandidate,
    _signals: RouterSignals,
  ): Promise<RoutingTarget> {
    return Promise.resolve(SAFE_DEFAULT_TARGET);
  }

  // ── Settings + logging ────────────────────────────────────────────────────

  private async globalMinScopes(): Promise<number> {
    try {
      return await this.settings.get<number>(
        LEARNING_ROUTER_SETTING_KEYS.globalMinScopes,
        LEARNING_ROUTER_SETTING_DEFAULTS.globalMinScopes,
      );
    } catch {
      return LEARNING_ROUTER_SETTING_DEFAULTS.globalMinScopes;
    }
  }

  private warn(candidateId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `LearningRouterService route degraded for candidate ${candidateId}: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

// ── Pure helpers (unit-tested directly) ──────────────────────────────────────

/**
 * Extract every cheap deterministic signal once. The combined lesson text is
 * `title\nsummary`; only structured booleans/counts/the provenance profile name
 * leave this function — never raw lesson text or a secret value.
 */
function gatherSignals(
  candidate: LearningCandidate,
  classifier: TemplateNoiseClassifier,
): RouterSignals {
  const lessonText = `${candidate.title}\n${candidate.summary}`;
  return {
    credential: containsCredentialSignal(lessonText),
    templateNoise: classifier.classify(candidate).isLowSignal,
    behavioural: BEHAVIOURAL_PATTERN.test(lessonText),
    agentProfile: extractAgentProfile(candidate),
    distinctScopes: deriveDistinctScopeCount(candidate),
    reusableProcedure: isReusableProcedure(lessonText),
  };
}

function routeCredential(
  candidate: LearningCandidate,
  signals: RouterSignals,
): RoutingDecision | null {
  if (!signals.credential) {
    return null;
  }
  return {
    target: 'project',
    scopeType: 'project',
    scopeId: candidate.scopeId,
    rationale:
      'credential / connection signal — pinned to project, never global',
    confidence: CONFIDENCE_CREDENTIAL,
    // Only non-sensitive flags — the secret value never enters the signals.
    signals: { credential: true, pinned: true },
  };
}

function routeDrop(signals: RouterSignals): RoutingDecision | null {
  if (!signals.templateNoise) {
    return null;
  }
  return {
    target: 'drop',
    scopeType: 'drop',
    scopeId: null,
    rationale: 'templated / low-signal noise → drop',
    confidence: CONFIDENCE_DROP,
    signals: { templateNoise: true },
  };
}

/**
 * A candidate explicitly captured against a workflow definition keeps its
 * workflow home — it must never be rewritten to `project` by the
 * scope-diversity pass (Epic C). Runs AFTER the credential and noise rails so
 * a credential-bearing or templated workflow capture is still pinned/dropped.
 */
function routeWorkflowScope(
  candidate: LearningCandidate,
): RoutingDecision | null {
  if (candidate.scope_type !== WORKFLOW_SCOPE_TYPE) {
    return null;
  }
  return {
    target: 'workflow',
    scopeType: WORKFLOW_SCOPE_TYPE,
    scopeId: candidate.scopeId,
    rationale: 'workflow-scoped capture → preserved workflow home',
    confidence: CONFIDENCE_WORKFLOW,
    signals: { workflowScoped: true },
  };
}

/**
 * A plain agent-scoped capture (`scope_type === 'agent'`) — no behavioural
 * always/never phrasing required — routes straight to `agent_preference` so it
 * is governed at the stricter 0.8 floor instead of falling through to the
 * lenient 0.5 project floor (PD-3). Mirrors `routeWorkflowScope`'s shape; the
 * agent identity (profile name) is preserved via `scopeId`. Runs AFTER the
 * credential/noise/workflow rails and BEFORE `routeAgentPreference`, so a
 * behavioural agent capture still resolves to the same `agent_preference`
 * target (no regression) even though this rail intercepts it first.
 */
function routeAgentScope(candidate: LearningCandidate): RoutingDecision | null {
  if (candidate.scope_type !== AGENT_SCOPE_TYPE) {
    return null;
  }
  return {
    target: 'agent_preference',
    scopeType: AGENT_SCOPE_TYPE,
    scopeId: candidate.scopeId,
    rationale:
      'agent-scoped capture → agent_preference (governed at the stricter 0.8 floor)',
    confidence: CONFIDENCE_AGENT,
    signals: { agentScoped: true, agentProfile: candidate.scopeId },
  };
}

function routeAgentPreference(signals: RouterSignals): RoutingDecision | null {
  if (!signals.behavioural || signals.agentProfile === null) {
    return null;
  }
  return {
    target: 'agent_preference',
    scopeType: 'agent',
    scopeId: signals.agentProfile,
    rationale: `behavioural always/never concentrated on profile ${signals.agentProfile} → agent_preference`,
    confidence: CONFIDENCE_AGENT,
    signals: { behavioural: true, agentProfile: signals.agentProfile },
  };
}

function globalDecision(
  distinctScopes: number,
  rationale: string,
): RoutingDecision {
  return {
    target: 'global',
    scopeType: GLOBAL_SCOPE_TYPE,
    scopeId: null,
    rationale,
    confidence: CONFIDENCE_GLOBAL,
    signals: { distinctScopes },
  };
}

function safeProjectDecision(
  candidate: LearningCandidate,
  rationale: string,
): RoutingDecision {
  return {
    target: SAFE_DEFAULT_TARGET,
    scopeType: 'project',
    scopeId: candidate.scopeId,
    rationale,
    confidence: CONFIDENCE_SAFE_DEFAULT,
    signals: { safeDefault: true },
  };
}

/**
 * Resolve the provenance agent-profile name from `signals_json` (provenance or
 * top-level) or `diagnostics_json`. Returns null when absent/blank.
 */
function extractAgentProfile(candidate: LearningCandidate): string | null {
  const signals = candidate.signals_json ?? {};
  const provenance = (signals.provenance ?? {}) as Record<string, unknown>;
  const diagnostics = candidate.diagnostics_json ?? {};
  const value =
    provenance.agentProfileName ??
    signals.agentProfileName ??
    diagnostics.agentProfileName;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Distinct-scope count for cross-scope global routing — see the class JSDoc for
 * the documented precedence. Defaults to 1 (single scope, the safe default).
 */
function deriveDistinctScopeCount(candidate: LearningCandidate): number {
  const signals = candidate.signals_json ?? {};
  const explicit = signals.distinct_scope_count;
  if (
    typeof explicit === 'number' &&
    Number.isFinite(explicit) &&
    explicit >= 1
  ) {
    return Math.floor(explicit);
  }
  const clusterScopes = signals.cluster_scopes;
  if (Array.isArray(clusterScopes)) {
    const distinct = new Set(
      clusterScopes.filter(
        (scope): scope is string => typeof scope === 'string',
      ),
    );
    if (distinct.size >= 1) {
      return distinct.size;
    }
  }
  return 1;
}

/** True when the text reads as a reusable multi-step procedure. */
function isReusableProcedure(text: string): boolean {
  const numbered = text.match(NUMBERED_STEP_PATTERN)?.length ?? 0;
  if (numbered >= 2) {
    return true;
  }
  const sequence = text.match(SEQUENCE_WORD_PATTERN)?.length ?? 0;
  return numbered + sequence >= 2;
}
