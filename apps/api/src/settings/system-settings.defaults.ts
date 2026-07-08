/**
 * Default system-setting values for `SystemSettingsService.seedDefaults()`.
 *
 * Split out of `system-settings.service.ts` (work item
 * 0cead042-e823-4e26-9386-02042252ffb0) so the service file stays
 * under the project's `max-lines` lint cap while the constant
 * registry continues to grow as new operator-tunable knobs land
 * (e.g. the memory-drift detector's cron, kill switch, and
 * confidence-penalty settings).
 *
 * The `SYSTEM_SETTING_DEFAULTS` record is the *single source of
 * truth* for the keyed defaults; every key the service may read
 * via `settings.get(key, defaultValue)` MUST be seeded here so the
 * `get(...)` call returns a sane value on a fresh database.
 *
 * The canonical storage is now distributed across 14 sibling
 * `*.settings.constants.ts` fragment files (referenced via
 * `...XXX_SYSTEM_SETTING_DEFAULTS` spread sites) so this central
 * registry can stay under the project's `max-lines` lint cap while
 * the operator-tunable knob surface continues to grow.
 *
 * The record is also re-exported from
 * `apps/api/src/settings/system-settings.service.ts` for backwards
 * compatibility with the existing test surface
 * (`system-settings.service.spec.ts` imports `SYSTEM_SETTING_DEFAULTS`
 * directly from the service file). The service module is the
 * canonical consumer; this file is the canonical storage.
 */

import { TELEGRAM_SYSTEM_SETTING_DEFAULTS } from './telegram-settings.constants';
import { WORKFLOW_STAGE_SKILL_POLICY_SYSTEM_SETTING_DEFAULTS } from './workflow-stage-skill-policy.default';
import { RETROSPECTIVE_FAILURE_THRESHOLD_SYSTEM_SETTING_DEFAULTS } from './retrospective-failure-threshold-settings.constants';
import { LEARNING_MEMORY_SYSTEM_SETTING_DEFAULTS } from './learning-memory.settings.constants';
import { MEMORY_DECAY_DRIFT_DEFAULTS_SYSTEM_SETTING_DEFAULTS } from './memory-decay-drift-defaults.settings.constants';
import { CANDIDATE_SIMILARITY_SCORING_SYSTEM_SETTING_DEFAULTS } from './candidate-similarity-scoring.settings.constants';
import { MEMORY_RETRIEVAL_MODE_SYSTEM_SETTING_DEFAULTS } from './memory-retrieval-mode.settings.constants';
import { RETROSPECTIVE_ENABLED_SYSTEM_SETTING_DEFAULTS } from '../workflow/workflow-retrospective/retrospective-enabled.settings';
import { RETROSPECTIVE_GATE_SYSTEM_SETTING_DEFAULTS } from '../workflow/workflow-retrospective/retrospective-gate.settings.constants';
import { RETROSPECTIVE_DRAIN_SYSTEM_SETTING_DEFAULTS } from '../workflow/workflow-retrospective/retrospective-drain.settings.constants';
import { RUN_TRANSCRIPT_DIGEST_SYSTEM_SETTING_DEFAULTS } from '../workflow/workflow-retrospective/run-transcript-digest.settings.constants';
import { RETROSPECTIVE_ROUTER_SYSTEM_SETTING_DEFAULTS } from '../workflow/workflow-retrospective/retrospective-router.settings.constants';
import { RETROSPECTIVE_DEDUP_SCOPE_SYSTEM_SETTING_DEFAULTS } from '../workflow/workflow-retrospective/retrospective-dedup-scope.settings.constants';
import { LEARNING_ROUTER_SYSTEM_SETTING_DEFAULTS } from '../memory/learning/learning-router.settings.constants';
import { GOVERNANCE_SYSTEM_SETTING_DEFAULTS } from '../memory/learning/governance.settings.constants';
import { MEMORY_DECAY_VALUE_SYSTEM_SETTING_DEFAULTS } from './memory-decay-value.settings.constants';
import { MEMORY_DECAY_DRIFT_SYSTEM_SETTING_DEFAULTS } from './memory-decay-drift.settings.constants';
import { MEMORY_CONTRADICTION_SYSTEM_SETTING_DEFAULTS } from './memory-contradiction.settings.constants';
import { LEARNING_MEASUREMENT_SYSTEM_SETTING_DEFAULTS } from './learning-measurement.settings.constants';
import { MEMORY_PROBATION_SYSTEM_SETTING_DEFAULTS } from './memory-probation.settings.constants';
import { FEEDBACK_WEIGHT_TUNER_SYSTEM_SETTING_DEFAULTS } from './feedback-weight-tuner.settings.constants';
import { WORKFLOW_POSTMORTEM_WRITEBACK_SYSTEM_SETTING_DEFAULTS } from './workflow-postmortem-writeback.settings.constants';
import { SKILL_SCOPE_CONFIRMATION_SYSTEM_SETTING_DEFAULTS } from './skill-scope-confirmation.settings.constants';
import { ORCHESTRATION_CYCLE_CANDIDATE_SYSTEM_SETTING_DEFAULTS } from './orchestration-cycle-candidate.settings.constants';
import { CHAT_SESSION_LEARNING_FLUSH_SYSTEM_SETTING_DEFAULTS } from './chat-session-learning-flush.settings';
import { IMPROVEMENT_GOVERNANCE_SYSTEM_SETTING_DEFAULTS } from '../improvement/governance/improvement-governance.settings.constants';
import { LEARNING_CONVERGENCE_SYSTEM_SETTING_DEFAULTS } from '../memory/learning/learning-convergence/settings/learning-convergence.settings.constants';
// -----------------------------------------------------------------
// Work item 52666e94-e403-4d00-97ab-95a3cc8af256 — milestone 1+2+3
//
// Settings fragments split out of this file so the registry module
// stays under the project's `max-lines` lint cap while the
// operator-tunable knob surface continues to grow. Each spread
// preserves the seeded keys byte-identical to the pre-refactor
// inline entries; the corresponding `system-settings.service.spec.ts`
// exhaustive assertion at lines 36-119 is the safety net.
// -----------------------------------------------------------------
import { AGENT_MESH_SYSTEM_SETTING_DEFAULTS } from './agent-mesh.settings.constants';
import { CHAT_SESSION_AUTO_RETRY_SYSTEM_SETTING_DEFAULTS } from './chat-session-auto-retry.settings.constants';
import { MEMORY_CAPTURE_SYSTEM_SETTING_DEFAULTS } from './memory-capture.settings.constants';
import { QUESTION_IDLE_TRACKER_SYSTEM_SETTING_DEFAULTS } from './question-idle-tracker.settings.constants';
import { RBAC_ENFORCEMENT_MODE_SYSTEM_SETTING_DEFAULTS } from './rbac-enforcement-mode.settings.constants';
import { SCHEDULED_JOBS_SYSTEM_SETTING_DEFAULTS } from './scheduled-jobs.settings.constants';
import { WAR_ROOM_SYSTEM_SETTING_DEFAULTS } from './war-room.settings.constants';
import { WORKFLOW_AUTO_RETRY_SYSTEM_SETTING_DEFAULTS } from './workflow-auto-retry.settings.constants';
import { WORKFLOW_HOST_MOUNT_SYSTEM_SETTING_DEFAULTS } from './workflow-host-mount.settings.constants';

/** Known system setting keys with their typed defaults. */
export const SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  ...QUESTION_IDLE_TRACKER_SYSTEM_SETTING_DEFAULTS,
  ...SCHEDULED_JOBS_SYSTEM_SETTING_DEFAULTS,
  ...WORKFLOW_HOST_MOUNT_SYSTEM_SETTING_DEFAULTS,
  ...AGENT_MESH_SYSTEM_SETTING_DEFAULTS,
  ...WAR_ROOM_SYSTEM_SETTING_DEFAULTS,
  ...WORKFLOW_STAGE_SKILL_POLICY_SYSTEM_SETTING_DEFAULTS,
  ...WORKFLOW_AUTO_RETRY_SYSTEM_SETTING_DEFAULTS,
  ...CHAT_SESSION_AUTO_RETRY_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // Learning + memory-system operator-tunable knobs
  //
  // Consolidated into `learning-memory.settings.constants.ts` so the
  // registry module stays under the `max-lines` lint cap while the
  // learning/memory surface continues to grow. The fragment imports
  // the typed keys + defaults + Zod bounds from sibling leaf modules
  // and quotes the same ranges the Zod schemas enforce, so the
  // operator-facing UI text and the validation bounds stay in
  // lock-step. Spread is byte-identical to the pre-refactor inline
  // registry.
  // -----------------------------------------------------------------
  ...LEARNING_MEMORY_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // Memory-decay reaper + memory-drift detector operator knobs
  //
  // Consolidated into
  // `memory-decay-drift-defaults.settings.constants.ts` so the
  // registry module stays under the `max-lines` lint cap. The
  // fragment imports the typed keys + hardcoded defaults from the
  // source-of-truth files in `apps/api/src/memory/` so the registry
  // stays in lock-step with the runtime constants the reaper /
  // detector services fall back to. Spread is byte-identical to the
  // pre-refactor inline registry.
  // -----------------------------------------------------------------
  ...MEMORY_DECAY_DRIFT_DEFAULTS_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // Workflow-failure postmortem writeback (work item 5743ac93)
  //
  // Extracted into its own fragment so this file stays under the
  // `max-lines` cap; the spread keeps the seeded keys byte-identical.
  // -----------------------------------------------------------------
  ...WORKFLOW_POSTMORTEM_WRITEBACK_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // Failure-threshold retrospective trigger (work item
  // 2ec2799b-b003-4f5d-bca4-d56d3ef601dd / WI-2026-063)
  // -----------------------------------------------------------------
  //
  // Closes OPEN_QUESTIONS K2 + K4 + K5. The keys, defaults, Zod
  // bounds, and seeded {value, description} entries live in the
  // fragment imported below — the implementing service reads them
  // from SystemSettingsService on every checkFailureThreshold()
  // call. The legacy `FAILURE_THRESHOLD_COUNT` env var remains a
  // deployment-time default for `Count` (see AC-3 in the work item)
  // so existing deployments do not break.
  ...RETROSPECTIVE_FAILURE_THRESHOLD_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // Memory/learning-loop Phase 0 (EPIC-212)
  // -----------------------------------------------------------------
  //
  // The two templated learning-candidate emitters were retired in Phase 2
  // (Task 12) — the retrospective analyst now mines successes/failures, so the
  // `learning_templated_emitters_enabled` kill switch was removed with them.
  // The postmortem `memory_segments` write and the recurrence count read remain
  // active as deterministic Phase-2 gate signals.
  ...MEMORY_CAPTURE_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // FU-16 — config-gated widening of the retrospective dedup blast radius
  // -----------------------------------------------------------------
  ...RETROSPECTIVE_DEDUP_SCOPE_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 1 — candidate similarity threshold + candidate
  // scoring weights (Task 8)
  //
  // Hand-set priors for the logistic composite score. Phase 3 tunes
  // these against empirical promotion-success data. All weight keys
  // use the `candidate_scoring_*` namespace so operators can filter
  // them in the settings UI.
  //
  // Formula:
  //   raw = w_recurrence·log(recurrence_count)
  //       + w_source_quality·source_quality_confidence
  //       + w_recency·recency_decay
  //       + w_diversity·min(stage_diversity_count, diversity_cap)/diversity_cap
  //       + beta
  //   score = σ(raw) = 1/(1+exp(-raw))
  // -----------------------------------------------------------------
  ...CANDIDATE_SIMILARITY_SCORING_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 1 — memory retrieval mode (Task 9)
  //
  // Controls whether the `RecentTaskSummaryProvider` injects memories
  // using hybrid vector recall or the legacy recency-ordered path.
  // Defaults to `hybrid` so the improvement is active immediately
  // once an embedding model is configured; with no model, `hybrid`
  // silently degrades to recency (fail-soft), making the default safe
  // to ship without a model configured.
  // -----------------------------------------------------------------
  ...MEMORY_RETRIEVAL_MODE_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 2 — retrospective analyst master kill-switch (Task 12)
  //
  // Off by default: the entire analyst path (enqueue, drain, analysis) is
  // inert and only the deterministic Phase-0/1 loop runs. Flip to true to
  // enable the gate→drain→analyst→router→governance pipeline.
  // -----------------------------------------------------------------
  ...RETROSPECTIVE_ENABLED_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 2 — retrospective interest gate (Task 2)
  //
  // Cheap deterministic weights/thresholds that decide which terminal runs
  // are worth an LLM retrospective. The constants file is the canonical
  // source; the gate re-reads each key on every scoring pass.
  // -----------------------------------------------------------------
  ...RETROSPECTIVE_GATE_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 2 — budget-capped retrospective drain (Task 3)
  //
  // Hard cost caps + cron for the windowed drain and the bypass path.
  // The constants file is the canonical source; the drain re-reads each
  // key on every tick so operators can re-tune cost without a restart.
  // -----------------------------------------------------------------
  ...RETROSPECTIVE_DRAIN_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 2 — token-bounded run digest (Task 4)
  //
  // Caps the struggle-anchored digest handed to the analyst. The constants
  // file is the canonical source; the digest service re-reads the key on every
  // build so operators can re-tune cost without a restart.
  // -----------------------------------------------------------------
  ...RUN_TRANSCRIPT_DIGEST_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 2 — retrospective output router confidence caps (Task 7)
  //
  // Re-derived confidence ceilings keyed on evidence class (struggle-backed vs
  // pure inference). The analyst self-report is ignored; these caps are the
  // hallucination neutralizer. The router re-reads each key on every routing
  // pass so operators can re-tune without a restart.
  // -----------------------------------------------------------------
  ...RETROSPECTIVE_ROUTER_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 2 — deterministic learning router (Task 8)
  //
  // Distinct-scope threshold a lesson must clear before routing `global`.
  // Cross-scope truth is the only path to global; nothing global auto-promotes.
  // -----------------------------------------------------------------
  ...LEARNING_ROUTER_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 2 — tiered promotion governance (Task 9)
  //
  // Stricter auto-promote floor for `agent_preference` plus the probation
  // window stamped on every `provisional` auto-promotion. `global` never
  // auto-promotes at any confidence; skill routes are always a proposal.
  // -----------------------------------------------------------------
  ...GOVERNANCE_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 3 — usefulness-aware decay value predicate (Task 2)
  //
  // `decay_value_predicate_mode` defaults to `legacy` so the reaper is
  // byte-identical to Phase-2. `shadow` observes + emits the divergence
  // (memory.decay.shadow.v1) without mutating; `enforce` lands in Task 3.
  // -----------------------------------------------------------------
  ...MEMORY_DECAY_VALUE_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 3 — drift-anchored self-invalidation (Task 4)
  //
  // `memory_decay_drift_invalidation_enabled` defaults to `false` so the
  // reaper is byte-identical to Task-3. When on, a `drift_detected_at`
  // row decays even inside grace, accelerated by the penalty multiplier.
  // -----------------------------------------------------------------
  ...MEMORY_DECAY_DRIFT_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 3 — memory contradiction detection + supersession (Task 5)
  //
  // `memory_contradiction_enabled` defaults to `false` so the promotion
  // path is byte-identical to Phase-2. When on, `memory_contradiction_mode`
  // (`shadow` default) emits the contradiction event without mutating;
  // `enforce` supersedes (archive-only) the contradicting loser.
  // -----------------------------------------------------------------
  ...MEMORY_CONTRADICTION_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 3 — causal-measurement trio (Task 6), probation
  // evaluator (Task 7), and weekly weight-tuner (Task 9). Every knob is
  // inert by default (holdout fraction 0, probation/tuner flags off,
  // behaviour-change read-only) so the deterministic loop is unchanged.
  // -----------------------------------------------------------------
  ...LEARNING_MEASUREMENT_SYSTEM_SETTING_DEFAULTS,
  ...MEMORY_PROBATION_SYSTEM_SETTING_DEFAULTS,
  ...FEEDBACK_WEIGHT_TUNER_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 Phase 4 — skill-scope auto-confirm mode (Task 7)
  //
  // Controls whether the analyst-recommended skill scope auto-applies
  // (`auto`), parks for human review (`manual`, default — byte-identical
  // to Phase-3 behaviour), or parks with a staged-eligible flag (`staged`).
  // -----------------------------------------------------------------
  ...SKILL_SCOPE_CONFIRMATION_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // EPIC-212 — noise hygiene: gate templated orchestration-cycle
  // learning candidate at API ingestion (Task B1). Off by default so
  // the ~714/7d row flood is blocked from birth at the consumer.
  // -----------------------------------------------------------------
  ...ORCHESTRATION_CYCLE_CANDIDATE_SYSTEM_SETTING_DEFAULTS,
  ...CHAT_SESSION_LEARNING_FLUSH_SYSTEM_SETTING_DEFAULTS,
  ...TELEGRAM_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // Self-improvement pipeline — governance policy mode + per-kind
  // overrides (Epic A, Task 3). Defaults to `tiered` so low-risk kinds
  // (skill_assignment) auto-apply while everything else proposes for
  // human review; confidence caps from the retrospective router still
  // apply in every mode.
  // -----------------------------------------------------------------
  ...IMPROVEMENT_GOVERNANCE_SYSTEM_SETTING_DEFAULTS,
  ...RBAC_ENFORCEMENT_MODE_SYSTEM_SETTING_DEFAULTS,
  // -----------------------------------------------------------------
  // Daily convergence recorder (work item
  // 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2)
  //
  // The `learning_convergence_cron` key drives the daily recorder
  // pass (default '0 2 * * *' — daily at 02:00 UTC, alongside the
  // memory-decay reaper). The companion
  // `learning_convergence_window_days` /
  // `learning_convergence_usefulness_min_samples` knobs tune the
  // recorder's snapshot horizon and the threshold-recalibration
  // floor. All three seed with the canonical defaults the
  // fragment declares; operator changes take effect on the next
  // recorder pass without restarting the API. Spread is
  // byte-identical to the fragment's record.
  // -----------------------------------------------------------------
  ...LEARNING_CONVERGENCE_SYSTEM_SETTING_DEFAULTS,
};
