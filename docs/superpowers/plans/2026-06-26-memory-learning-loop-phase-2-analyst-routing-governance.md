# Phase 2 — Real LLM retrospective analyst + deterministic routing + tiered governance: the loop reads runs, diagnoses, and routes safely

**Epic:** [EPIC-212](../../epics/EPIC-212-memory-learning-loop-rebuild.md)
**Created:** 2026-06-26
**Status:** Ready to execute (after Phase 1 ships)
**Scope:** Add the expensive, cost-bounded half of the loop on top of the Phase-0/1 primitives. A hybrid-triggered `WorkflowRetrospectiveModule` enqueues terminal runs, a cheap deterministic gate scores interest (inverting today's `ambiguous_failure` pathology), a budget-capped drain feeds a token-bounded struggle-anchored digest to a light-tier **retrospective analyst** that emits evidence-cited `findings[]`. A `RetrospectiveOutputRouter` re-derives confidence (so a hallucinated `0.95` cannot auto-promote) and feeds the **existing** `record_learning → sweep → promote` and `create_skill_proposal → create_skill` pipelines. A deterministic `LearningRouterService` infers scope (project | global | agent_preference | skill_new | skill_patch | drop) and a `PromotionGovernancePolicyService` enforces a tiered auto-promotion matrix. The analyst and router reuse the Phase-1 vector recall to dedup against **existing** memory, not just pending candidates.

## Goal

A failed run yields a real **root-cause + fix** memory; a struggle-on-success run yields a **working-procedure skill proposal**. Memories land in the correct scope with a visible rationale. Global memory **never** auto-promotes; a credential fact **never** routes global and its secret value is never stored. The analyst LLM call is cost-bounded (gate + drain budget + digest token cap) and fail-soft (no analyst → the Phase-0/1 deterministic loop still runs). This delivers EPIC-212 Pillar B (mining) and Pillar D (governance) on the Phase-1 vector foundation.

## Non-Goals (Phase 2)

- No lifecycle/decay/contradiction/measurement rework — Phase 3 (`MemoryContradictionService`, usefulness-aware decay, holdout lift, probation evaluator).
- No `FeedbackWeightTunerService` weight auto-tuning — Phase 3.
- No skill-durability hardening (runtime `SkillValidationService`, reseed preservation) — Phase 4.
- **No** new vector store, no new embedding model machinery — reuse Phase-1 `EmbeddingProviderService` / `EmbeddingSimilarityService` / `MemoryRetrievalService` as-is.
- **No** rebuild of struggle/similarity/scoring — `WorkflowRetrospectiveModule` **consumes** `MemorySignalsModule`; it owns only the LLM orchestration.
- No Kanban-domain logic in `apps/api`/`packages/core`; `signals_json`/`routing_target` carry no Kanban identifiers.

## Phase 0 + Phase 1 landed — what Phase 2 builds on (do not re-create)

Verified in this checkout (branch `epic-212-memory-learning-loop`):

- **`MemorySignalsModule`** (`apps/api/src/memory/signals/memory-signals.module.ts`) is fully built and exports: `StruggleDetectorService`, `EmbeddingProviderService`, `EmbeddingSimilarityService`, `CANDIDATE_SIMILARITY` (symbol → `EmbeddingSimilarityService`), `MemoryRetrievalService`, `CandidateClustererService`, `CandidateScoringService`, `TemplateNoiseClassifier`, `EmbeddingBackfillService`, `EmbeddingReindexService`.
- **`StruggleDetectorService.detect(runId): Promise<StruggleSpan[]>`** (`struggle-detector.service.ts:86`) is **public** and queries `event_ledger` via `EventLedgerRepository.query` (`domain:'tool'`, `event_name:'tool.execution.completed'`, capped at 1000 rows). The gate + digest reuse this directly.
- **`EmbeddingSimilarityService.findNearest(text, k, scope)`** runs scope-filtered cosine KNN over `memory_embeddings`; `MemoryRetrievalService.retrieve({ scopeId, queryText, tokenBudget })` is the "already known" dedup seam.
- **`RecordLearningService.recordLearning(context, params, options?)`** seam — `RecordLearningOptions { candidateType, sourceTool, sourceQualityConfidence, humanApprovedAt, signalsJsonExtra }`. Exact-fingerprint dedup reinforces; auto-fires `memory_learning_sweep` at `pendingCount >= 10`. This is the birth path for analyst `memory` findings.
- **`SkillProposalService`** + the `create_skill_proposal` tool is the birth path for `skill_proposal` findings.
- **`LearningPromotionService.promoteCandidate`** → `LearningPromotionPolicyService.evaluate` (0.5 floor) → `memoryManager.createMemorySegment(scope_type, scopeId, lesson, 'fact', buildMetadata(...))`. `promotion_policy` is written into `metadata_json`. **This is where route-awareness + governance insert.**
- **`learning_candidates` entity**: `signals_json` JSONB, `score`, `confidence`, `source_quality_confidence`, `human_approved_at`, `status`, `diagnostics_json`, indexes `idx_learning_candidates_status_score` + `idx_learning_candidates_scope_status`. **No `routing_target` column yet** (Task 8 adds it).
- **`memory_segments` entity**: `entity_type`/`entity_id`, `memory_type` enum (`preference`|`fact`|`history`|`strategic_intent`), `metadata_json`, `pinned`, `source` varchar(64), `@BeforeInsert syncSourceFromMetadata`. **No `governance_state` column yet** (Task 9 adds it).
- **BullMQ convention** (Phase-1 clusterer): constants file → scheduler (`OnApplicationBootstrap`, stable `jobId`, repeatable, fail-soft) → processor (`WorkerHost`, `@Processor`); queue via `BullModule.registerQueue` (`candidate-clusterer.scheduler.ts` / `.processor.ts` / `.constants.ts`). The clusterer processor also chains `CandidateScoringService.scoreAll()` after clustering — the routing pass (Task 8) chains here too.
- **Migration convention**: `class Xxx<ts> implements MigrationInterface`, idempotent `IF NOT EXISTS`, **prepended** to `registeredMigrations` (`apps/api/src/database/migrations/registered-migrations.ts`). Latest is `20260703000000-add-embedding-model-columns`. Phase-2 timestamps start `20260704000000`.
- **Settings registry**: `SYSTEM_SETTING_DEFAULTS` (`apps/api/src/settings/system-settings.defaults.ts`) is the single source of truth; per-feature constants live in dedicated `*-settings.constants.ts` files.
- **Phase-1 carry-forwards still open**: the two templated emitters remain **gated off** (`learning_templated_emitters_enabled`, default off) via `resolveTemplatedEmittersEnabled` — Phase 2 retires them (Task 12). `StruggleDetectorService` 1000-event scan cap — re-used by the gate/digest with the same cap. `list_pending_learning_candidates` honest count (`total_sweep_eligible`) is page-scoped (documented).

## Pre-flight verification (do before writing code)

1. **Confirm the analyst-launch seam.** `RecordLearningService` launches the sweep via the workflow engine `startWorkflow('memory_learning_sweep', triggerVars)`. Confirm the same signature can launch `run_retrospective` with `{ trigger: { scopeId, workflow_run_id, agent_profile }, digest, evidence_event_ids }`, and confirm how a workflow's `set_job_output` is read back by the launching service (the sweep reads `output_contract` keys). The orchestrator (Task 6) must await the run's output contract — verify whether `startWorkflow` resolves on completion or whether a `WORKFLOW_RUN_COMPLETED_EVENT` listener keyed on `workflow_id='run_retrospective'` is required (mirror `WorkflowSuccessLearnerListener`).
2. **Confirm seed loading.** Verify how `seed/workflows/*.yaml` + `seed/agents/*/agent.json` are loaded at startup so `run-retrospective.workflow.yaml` + `retrospective-analyst/agent.json` + `prompts/run-retrospective/analyze.md` register without extra wiring. Use the `seed-workflow-patterns` and `workflow-yaml-authoring` skills.
3. **Confirm the digest source decision.** The Phase-0 Task-0 spike decided `event_ledger` (append-only, normalized) is the reliable source over `pi_session_trees` (base64(gzip(JSONL)) + distillation TOCTOU). Confirm `EventLedgerRepository.query` returns enough per-run signal (tool calls, outcomes, error codes, payloads) to build a struggle-anchored digest; `TokenCounterService` is the token-bound helper. Record the chosen digest schema here.
4. **Confirm `WORKFLOW_RUN_FAILED_EVENT` payload shape.** Confirm the **failed** event carries the same `stateVariables.trigger.scopeId` as the completed event so the gate can enqueue uniformly. Both constants live at `workflow-events.constants.ts`.
5. **Confirm the governance scope for `agent_preference`.** A behavioural always/never routes to a `memory_segments` row with `entity_type='agent'`, `memory_type='preference'`. Confirm `MemoryManagerService.createMemorySegment` accepts an `'agent'` scope_type + `'preference'` memory_type; record the exact call shape the route-aware dispatch (Task 10) will use.

---

## Task 1 — `WorkflowRetrospectiveModule` scaffold + `retrospective_queue` entity/migration + cheap enqueue on terminal events · M

Stand up the new Kanban-neutral workflow-adjacent module and the durable queue table. Cheapest first: enqueue costs nothing but a row.

- **Entity + repository** (`adding-entity-migration` skill): ADD `apps/api/src/workflow/workflow-retrospective/database/entities/retrospective-queue.entity.ts` — `@Entity('retrospective_queue')` with `id uuid pk`, `workflow_run_id uuid`, `scope_id varchar(160) null`, `terminal_status varchar(32)` (`completed`|`failed`), `interest_score double precision default 0`, `priority varchar(16) default 'normal'` (`bypass`|`high`|`normal`|`low`), `status varchar(24) default 'queued'` (`queued`|`draining`|`analyzed`|`skipped`|`failed`), `signals_json jsonb default '{}'`, `enqueued_at`, `drained_at null`, `created_at`/`updated_at`. Unique index on `workflow_run_id` (idempotent enqueue), partial index `idx_retrospective_queue_status_priority (status, priority, interest_score DESC)` for the drain query. ADD `retrospective-queue.repository.ts` (`create`, `findByRunId`, `claimTopN(limit, statuses)`, `markStatus`, `countByStatus`).
- **Migration:** ADD `apps/api/src/database/migrations/20260704000000-create-retrospective-queue.ts` (idempotent `CREATE TABLE IF NOT EXISTS` + indexes; `down` drops); register (prepend) in `registered-migrations.ts`. Register the entity in `DatabaseModule`.
- **Enqueue listener:** ADD `retrospective-enqueue.listener.ts` — `@OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)` + `@OnEvent(WORKFLOW_RUN_FAILED_EVENT)` (mirror `WorkflowSuccessLearnerListener`), resolve `scopeId` via the shared `resolveScopeId(stateVariables)` helper, upsert a `queued` row (best-effort, swallow-and-warn). **Skip the `run_retrospective` workflow itself** (no infinite loop) and the sweep/CEO singleton workflows by `workflow_id`.
- **Module + boundary:** ADD `workflow-retrospective.module.ts` importing `MemorySignalsModule`, `LearningModule` (for `RecordLearningService`), `DatabaseModule`, `SystemSettingsModule`, `ObservabilityModule`, and the workflow engine module (Pre-flight #1). Register in `AppModule`. ADD a `WorkflowRetrospectiveModule` row to the **Workflow Module Boundaries** table in CLAUDE.md.

**TDD:**

- _Red:_ a spec asserting both terminal events upsert exactly one `retrospective_queue` row keyed on `workflow_run_id` (second event for the same run is a no-op, not a duplicate); the `run_retrospective` workflow's own terminal event enqueues **nothing**; a missing `scopeId` still enqueues with `scope_id=null` (failed runs may lack scope) but is flagged.
- _Green:_ implement entity, migration, repository, listener, module; migration `.spec.ts` mirroring `20260702000000-create-memory-embeddings.spec.ts`.
- _Refactor:_ extract the shared `resolveScopeId` helper (today duplicated in struggle detector + success listener) into a module-local util.

**Acceptance:** a completed and a failed run each leave one `queued` row; re-emission is idempotent; the analyst workflow never enqueues itself; `AppModule` boots with the new module.

## Task 2 — `RetrospectiveGateService` — cheap deterministic interest score (inverts the pathology) · M

A pure-ish scorer that decides _which_ runs are worth an LLM. It **inverts** today's bug where `ambiguous_failure` is highest-confidence.

- ADD `apps/api/src/workflow/workflow-retrospective/retrospective-gate.service.ts` (+ `.types.ts` for `InterestScore { score, priority, reasons[], evidenceEventIds[] }`).
- **Signals (all cheap, deterministic, reuse Phase-0):**
  - **Recovered-struggle-on-success → highest.** Call `StruggleDetectorService.detect(runId)`; ≥1 span on a `completed` run ⇒ top priority (`high`/`bypass`), carry `span.tool` + recovering-call evidence event ids.
  - **`ambiguous_failure` → low priority.** Read the failure classification from the run's postmortem signals; if the only signal is the catch-all `ambiguous_failure` with no anchored error code, floor the score.
  - **Anchored failure (real error_code, repeated failed command, novel tool sequence) → high.** Derive from the same `event_ledger` tool-execution rows the struggle detector loads (retry count, distinct error codes, failed-then-failed without recovery).
  - **Trivial/duration outliers → low** (mirror the success listener's `< 30s` / `> 7200s` filters).
- **Output:** write `interest_score`, `priority`, and `signals_json` (with `evidence_event_ids`) back onto the `retrospective_queue` row. `priority='bypass'` marks high-signal failures for immediate analysis (Task 3 short-circuit).

**TDD:**

- _Red:_ fixtures — (a) a struggle-on-success run scores `bypass`/`high` with the recovering tool in `reasons`; (b) an `ambiguous_failure`-only run scores `low`; (c) an anchored failure with a real `error_code` scores `high`; (d) a 5-second clean run scores `low`. Assert `evidence_event_ids` are populated from the ledger rows, never invented.
- _Green:_ implement; reuse `StruggleDetectorService.detect` and one `EventLedgerRepository.query` (respect the 1000-row cap + warn).
- _Refactor:_ pull thresholds/weights into `retrospective-gate.settings.constants.ts` (seeded in `SYSTEM_SETTING_DEFAULTS`).

**Acceptance:** the gate ranks a recovered-struggle-on-success run above an `ambiguous_failure` run deterministically, with zero LLM calls and ledger-cited evidence.

## Task 3 — `RetrospectiveDrainScheduler` + processor — budget-capped drain, high-signal bypass · M

The cost governor. A BullMQ repeatable job drains the top-N highest-interest queued runs per window; `bypass` rows skip the wait.

- ADD `retrospective-drain.constants.ts` (queue `retrospective-drain`, job name, stable repeat `jobId`, default cron e.g. hourly, `removeOnComplete/Fail` — mirror `candidate-clusterer.constants.ts`), `retrospective-drain.scheduler.ts` (`OnApplicationBootstrap`, fail-soft register — mirror `candidate-clusterer.scheduler.ts`), `retrospective-drain.processor.ts` (`WorkerHost`, `@Processor`).
- **Drain logic** in a `RetrospectiveDrainService`: read `retrospective_drain_budget_per_window` (default small, e.g. 5) from settings; `repository.claimTopN(budget, ['queued'])` ordered by `priority` then `interest_score DESC`; for each, hand off to the gate-scored digest+analysis orchestrator (Task 6), mark `draining → analyzed|failed`. Below an `interest_floor` setting, mark `skipped` without analysis (never spend LLM on noise).
- **Bypass path:** the enqueue listener (Task 1) or gate (Task 2) calls `RetrospectiveDrainService.analyzeImmediately(runId)` for `priority='bypass'` so a high-signal failure is analyzed on the spot, outside the window — still counted against a separate `retrospective_bypass_budget` to bound cost.
- Register the queue in `WorkflowRetrospectiveModule` via `BullModule.registerQueue`.

**TDD:**

- _Red:_ with 20 queued rows and `budget=5`, exactly 5 are claimed/analyzed per tick, highest-priority first; rows below `interest_floor` are marked `skipped` (no orchestrator call); a `bypass` row is analyzed immediately and decrements the bypass budget; a scheduler registration failure is swallowed (app boots).
- _Green:_ implement scheduler/processor/service mirroring the clusterer trio; assert the BullMQ `queue.add` arg shape in a scheduler spec.
- _Refactor:_ share `normaliseCronExpression` (re-exported from `memory-eviction.processor`) as the clusterer does.

**Acceptance:** the drain never exceeds the per-window budget; `bypass` failures are analyzed immediately within a separate budget; sub-floor runs cost nothing.

## Task 4 — `RunTranscriptDigestService` — token-bounded, struggle-anchored, fail-soft digest · L

The single biggest cost lever: compress a run's evidence to a small, high-signal digest before the analyst ever sees it.

- ADD `apps/api/src/workflow/workflow-retrospective/run-transcript-digest.service.ts` (+ `.types.ts` for `RunDigest { runId, scopeId, struggleSpans[], toolTimeline[], errorClusters[], evidenceEventIds[], truncated }`).
- **Source priority (Pre-flight #3): `event_ledger` first.** Build the digest from `EventLedgerRepository.query` tool-execution rows + the `StruggleDetectorService.detect(runId)` spans (anchor the digest on the failed→recovered windows — the most actionable content). `pi_session_trees` is **not** the source. **Fail-soft:** any error building the digest returns a minimal event-ledger-only digest, never throws.
- **Token bound:** use `TokenCounterService` to cap the digest at a `retrospective_digest_max_tokens` setting; drop lowest-signal timeline entries first, always preserve the struggle spans + their recovering calls + error codes (mirror `buildSpanSummary`'s "keep the command that finally worked" discipline at `struggle-detector.service.ts`). Redact secrets/NUL via the existing `event-ledger` redaction utilities before the digest leaves the boundary (the EPIC's "never embed/store credential values" rail).
- Every digest line carries its source `event_id` so findings can cite `evidence_event_ids`.

**TDD:**

- _Red:_ a digest from a fixture ledger stays under the token cap, anchors on the struggle span, preserves the recovering command verbatim, and tags every line with an `event_id`; a run whose ledger query throws returns a non-empty minimal digest (`truncated:true`), never throws; a payload containing a secret-shaped string is redacted.
- _Green:_ implement using `EventLedgerRepository`, `StruggleDetectorService`, `TokenCounterService`, and the redaction util.
- _Refactor:_ extract the timeline-trim policy into a pure helper with its own unit tests.

**Acceptance:** a real run (`retrieve-session-logs` sample) digests to a bounded, struggle-anchored, secret-free, fully event-id-cited payload; a corrupt run degrades to a minimal digest without error.

## Task 5 — `run-retrospective` workflow + `retrospective-analyst` profile + prompt · M

The analyst itself: a light-tier, read-only agent that reads the digest and emits structured findings, citing evidence, returning `none` rather than inventing.

- **Agent profile:** ADD `seed/agents/retrospective-analyst/agent.json` — `"tier_preference": "light"`, deny-default `tool_policy` granting only read-only + `query_memory`, `set_job_output`, `step_complete` (mirror `junior_dev/agent.json` shape but read-only — no `write`/`edit`/`remember`; the **router**, not the analyst, writes). `assigned_skills` minimal.
- **Workflow:** ADD `seed/workflows/run-retrospective.workflow.yaml` — `workflow_id: run_retrospective`, `trigger: manual` with inputs `scope_id`, `workflow_run_id`, `digest`, `agent_profile`; one `tier: light` execution job, deny-default `tool_policy` (`query_memory`, `set_job_output`, `step_complete`), `output_contract.required: [findings]` (mirror `create-skill.workflow.yaml`). Concurrency `max_runs` modest.
- **Prompt:** ADD `seed/workflows/prompts/run-retrospective/analyze.md` — instruct the analyst to read `{{ trigger.digest }}`, and emit `findings[]` where each finding is `{ kind: 'memory'|'skill_proposal'|'none', lesson, root_cause, fix, working_procedure?, scope_hint?, confidence_self, evidence_event_ids[] }`. Demand **generalizable diagnosis** (root cause + fix; reusable working procedure), forbid narration, and mandate returning a single `{ kind:'none' }` finding when the run holds no durable lesson. Tell it to call `query_memory` to check whether the lesson is already known and skip if so. Use the `workflow-yaml-authoring` + `seed-workflow-patterns` skills.

**TDD:**

- _Red:_ a YAML/JSON contract spec asserting `run_retrospective` parses, is light-tier, read-only (no mutating tools in `tool_policy`), and declares `findings` in its output contract; an agent-profile contract spec asserting `retrospective-analyst` is light-tier and grants no write/remember/promote tools.
- _Green:_ author the three seed files; validate against the seed loader (`validate:seed-data`).
- _Refactor:_ factor the findings JSON shape into a `packages/core` `RetrospectiveFinding` interface (strict-provider-safe, flat) reused by Task 6/7.

**Acceptance:** the seed loads; the analyst workflow is read-only and light-tier; its output contract is `findings[]`; the prompt forbids invention and mandates evidence citation.

## Task 6 — `RetrospectiveAnalysisService` — orchestrate digest → analyst → parse → dedup-against-known · L

The glue: launch the analyst with the digest, parse findings, and drop findings already covered by existing memory (reusing Phase-1 vector recall, not just pending candidates).

- ADD `apps/api/src/workflow/workflow-retrospective/retrospective-analysis.service.ts`. Called by the drain (Task 3).
- **Launch:** `startWorkflow('run_retrospective', { trigger: { scope_id, workflow_run_id, agent_profile }, digest })`; await the `findings` output contract (Pre-flight #1 decides resolve-on-completion vs. a keyed `WORKFLOW_RUN_COMPLETED_EVENT` listener).
- **Parse + validate:** validate each finding against the `RetrospectiveFinding` Zod schema (Task 5 refactor); **verify `evidence_event_ids` exist** in the run's ledger (drop fabricated ids); discard `kind:'none'`.
- **Dedup against KNOWN memory:** for each surviving finding, call `MemoryRetrievalService.retrieve({ scopeId, queryText: finding.lesson, tokenBudget })` (or `EmbeddingSimilarityService.findNearest` over `ownerType:'memory_segment'`) — if a near-duplicate existing `memory_segment` is found above the Phase-1 `candidate_similarity_threshold`, **reinforce** (touch the existing segment / skip) instead of routing a new finding.
- **Fail-soft:** analyst timeout/parse failure marks the queue row `failed` and returns `[]` — the deterministic loop is unaffected.
- Hand surviving findings to `RetrospectiveOutputRouter` (Task 7).

**TDD:**

- _Red:_ a finding citing a non-existent `event_id` is dropped; a `none` finding produces no output; a finding whose lesson semantically matches an existing `memory_segment` is deduped (no new candidate) — assert via a stubbed `MemoryRetrievalService`; an analyst launch failure returns `[]` and marks the row `failed` without throwing.
- _Green:_ implement; inject `MemoryRetrievalService` + `EmbeddingSimilarityService` from `MemorySignalsModule`.
- _Refactor:_ extract evidence-existence verification into a pure helper.

**Acceptance:** only evidence-backed, not-already-known findings reach the router; everything is fail-soft.

## Task 7 — `RetrospectiveOutputRouter` — re-derive confidence, route into existing pipelines · M

Where hallucination is neutralized: the router, **not** the analyst, sets confidence and chooses the birth path.

- ADD `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.ts`.
- **Re-derive confidence (cap):** ignore `finding.confidence_self`. Compute confidence from evidence class: **struggle-backed** (the finding cites a `StruggleDetectorService` span / recovering call) → up to ~`0.7`; **pure inference** (no struggle anchor) → capped at ~`0.45` (below the 0.5 promotion floor, so it can never auto-promote without human approval). Constants in `retrospective-router.settings.constants.ts`.
- **Route by kind:**
  - `kind:'memory'` → `RecordLearningService.recordLearning(context, { scope_type, scope_id, lesson, evidence (from evidence_event_ids), confidence: <re-derived>, tags:['retrospective_analyst', struggle?'struggle_backed':'inference'] }, { candidateType:'retrospective', sourceTool:'retrospective_analyst', sourceQualityConfidence })`. This reuses the existing `record_learning → sweep → promote` pipeline and auto-fire threshold.
  - `kind:'skill_proposal'` → `SkillProposalService` (the `create_skill_proposal → create_skill` pipeline) with the working-procedure body; never auto-applied (skills are always a proposal per the governance matrix).
- **Credential/secret rail:** never store a secret value; a credential/connection finding routes as a project memory and never carries the secret (enforced here and re-checked in Task 8).

**TDD:**

- _Red:_ a finding self-reporting `confidence:0.95` with **no** struggle anchor produces a candidate with confidence ≤ 0.45 (cannot auto-promote); a struggle-backed finding produces ≤ 0.7; a `skill_proposal` finding creates a `SkillImprovementProposal`, not a memory; a finding whose lesson contains a secret-shaped value is rejected/redacted.
- _Green:_ implement; reuse `RecordLearningService` + `SkillProposalService`.
- _Refactor:_ centralize the re-derivation matrix in a pure function with exhaustive unit tests.

**Acceptance:** a hallucinated high self-confidence finding cannot auto-promote; struggle-backed findings get the higher (still sub-1.0) confidence; skill findings become proposals; secrets never persist.

## Task 8 — `routing_target` migration + `LearningRouterService` — deterministic scope inference · L

Decide each candidate's _home_ deterministically; only call the LLM to break ties.

- **Migration:** ADD `20260705000000-add-learning-candidate-routing-target.ts` — `ALTER TABLE learning_candidates ADD COLUMN IF NOT EXISTS routing_target varchar(24) NULL` (+ optional `idx_learning_candidates_routing_target`). Add the column to `learning-candidate.entity.ts`; prepend to `registered-migrations.ts`.
- ADD `apps/api/src/memory/learning/learning-router.service.ts` (+ `.types.ts` `RoutingDecision { target, scopeType, scopeId?, rationale, confidence, signals }`). Targets: `project | global | agent_preference | skill_new | skill_patch | drop`.
- **Deterministic signals (reuse Phase-1):**
  - **Scope diversity / cross-scope truth ≥3 scopes → `global`**; single-scope → `project` (count distinct scopes the lesson recurs across via the candidate's cluster / `recurrence`).
  - **Agent-concentration + behavioural always/never on one profile → `agent_preference`** (regex on lesson shape + provenance `agentProfileName` concentration).
  - **Reusable procedure (procedural length, imperative shape) → `skill_new`; refinement of an existing skill → `skill_patch`** via `EmbeddingSimilarityService.findNearest` against existing skills / `MemoryRetrievalService`.
  - **Credential/connection facts → `project`, pinned, NEVER `global`, never the secret value** (hard rule, short-circuits before any LLM arbitration).
  - **Templated/low-signal → `drop`** (reuse `TemplateNoiseClassifier`).
- **LLM arbitration only on ties / low scope-confidence** — bounded, fail-soft (on failure default to the safest deterministic target, never `global`).
- **Where it runs:** invoke `LearningRouterService.route(candidate)` in the nightly `CandidateClustererProcessor` **after** scoring, writing `routing_target` — so the column is populated before the 2am sweep and before any promotion.

**TDD:**

- _Red:_ a lesson recurring across 3 scopes → `global`; a single-scope fact → `project`; a credential fact → `project`+pinned, **never** `global`, secret stripped; a "always do X for profile Y" → `agent_preference`; a reusable procedure → `skill_new`; a refinement matching an existing skill (stubbed similarity hit) → `skill_patch`; a templated row → `drop`; a tie triggers exactly one bounded LLM arbitration call and falls back safely on failure.
- _Green:_ implement; inject `CANDIDATE_SIMILARITY` + `MemoryRetrievalService` + `TemplateNoiseClassifier` from `MemorySignalsModule`.
- _Refactor:_ scope-inference weights/regexes into `learning-router.settings.constants.ts`.

**Acceptance:** every candidate carries a deterministic `routing_target`; credentials never route global; cross-scope truth routes global; LLM is used only to break ties and is fail-soft.

## Task 9 — `governance_state` migration + `PromotionGovernancePolicyService` — tiered matrix · M

Encode _who may auto-promote_ as a tiered policy, with provisional + probation for anything auto-promoted.

- **Migration:** ADD `20260706000000-add-memory-segment-governance-state.ts` — `ALTER TABLE memory_segments ADD COLUMN IF NOT EXISTS governance_state varchar(24) NULL` (values `provisional` | `confirmed` | null-legacy). Add to `memory-segment.entity.ts`; prepend to `registered-migrations.ts`.
- ADD `apps/api/src/memory/learning/promotion-governance-policy.service.ts` (+ `.types.ts` `GovernanceDecision { autoPromote, governanceState, probationUntil?, requiresProposal, drop, reason }`). **Tiered matrix keyed on `routing_target` + confidence:**
  - `project` fact → **auto-promote** (`governance_state='provisional'` + probation window) at high confidence.
  - `agent_preference` → stricter, auto-promote only at **≥0.8**.
  - `global` → **never auto** (always human/proposal), regardless of confidence.
  - `skill_new`/`skill_patch` → **always a proposal** (never a direct segment).
  - templates / `drop` → **auto-drop**.
- Probation window from `governance_probation_days` setting; auto-promoted rows carry `governance_state='provisional'` (Phase 3 adds the probation evaluator that confirms or reverts).

**TDD:**

- _Red:_ a `global` finding at confidence 0.99 → **not** auto-promoted (`requiresProposal`/human); a `project` fact at high confidence → auto-promote with `governance_state='provisional'` + `probationUntil`; an `agent_preference` at 0.75 → not auto, at 0.85 → auto; a `skill_*` target → `requiresProposal`; a template → `drop`.
- _Green:_ implement as a pure decision service (no I/O), unit-tested across the matrix.
- _Refactor:_ thresholds into `governance.settings.constants.ts` seeded in `SYSTEM_SETTING_DEFAULTS`.

**Acceptance:** the matrix matches the EPIC: project auto (provisional), agent stricter, global never auto, skills always proposal, templates dropped.

## Task 10 — Route-aware `LearningPromotionService` dispatch (consume `routing_target` + governance) · L

Wire routing + governance into the **existing** promotion entry point — the load-bearing integration.

- EDIT `apps/api/src/memory/learning/learning-promotion.service.ts`. In `promoteCandidate`, after `claimPendingPromotion` and **before** `policy.evaluate`/`createMemorySegment`:
  1. Read `candidate.routing_target` (Task 8). If null, fall through to today's behaviour (backward-compatible default = `project`).
  2. Consult `PromotionGovernancePolicyService` (Task 9) with `{ routingTarget, confidence }`.
  3. **Branch dispatch:**
     - `project` / `global` / `agent_preference` + `autoPromote` → `createMemorySegment` with the **scope from the routing decision** (`agent_preference` → `entity_type='agent'`, `memory_type='preference'`; project/global → `fact`) and **set `governance_state`** on the new segment (extend `buildMetadata`/`createMemorySegment` call). `global` non-auto → release claim, leave candidate pending for human/proposal (do **not** create a segment).
     - `skill_new` / `skill_patch` → do **not** create a memory segment; emit/route to `SkillProposalService` (or mark the candidate `routed_to_proposal`) so the `create_skill` pipeline owns it.
     - `drop` → mark candidate `dropped`, no segment.
  4. Preserve the existing claim/idempotency/event-emit machinery (`emitSucceeded`/`emitPromoted`/`emitFailed`) — only the _destination_ changes.
- The 0.5 floor (`LearningPromotionPolicyService`) still applies **in addition** to the governance matrix (defence in depth).

**TDD:**

- _Red:_ a `global` candidate is **never** auto-promoted to a segment (claim released, candidate stays pending); a `project` auto-promote creates a `memory_segment` with `governance_state='provisional'`; an `agent_preference` auto-promote creates an `entity_type='agent'` `preference` segment; a `skill_new` candidate creates a proposal and **no** segment; a `drop` candidate creates nothing and is marked dropped; legacy candidates with `routing_target=null` behave exactly as today (regression guard on the existing `learning-promotion.service.spec.ts`).
- _Green:_ implement the branch; thread `governance_state` through `createMemorySegment`/`buildMetadata`.
- _Refactor:_ extract the dispatch branch into a private `dispatchByRoute` method to keep `promoteCandidate` under the complexity/line caps.

**Acceptance:** promotion honours `routing_target` + governance; global never auto-lands; auto-promotions are provisional; skill routes become proposals; the existing promotion path is unbroken for un-routed candidates.

## Task 11 — `LearningTabDiffPreview.tsx` — before/after for skill-patch + memory contradiction/update · M

The operator-facing review surface for routed/patched learnings.

- ADD `apps/web/src/pages/project-workspace/LearningTabDiffPreview.tsx` — a presentation component rendering before/after for: (a) `skill_patch` proposals (current SKILL.md vs. proposed — `SkillProposalService.getPreview` returns `current_markdown`/`proposed_markdown`/`resulting_markdown`); (b) memory contradiction/update (existing segment vs. proposed routed finding). Side effects live in a `useSkillProposalPreview` hook (web quality gate — components are presentation-only). Wire into the existing `LearningTab*` shell alongside the Phase-1 `LearningTabClusterCard`/`CandidateClusterCard`.
- Show the routing badge (`routing_target`) + the governance state (`provisional`) + "why this scope" rationale from the `RoutingDecision`.

**TDD (`test:unit:web`):**

- _Red:_ given a skill-patch preview payload, the component renders an added/removed diff and the routing/governance badges; given a memory-update payload, it renders old vs. new content; an empty/loading state renders without crashing.
- _Green:_ implement the component + hook; reuse the existing proposals API.
- _Refactor:_ share the diff renderer with any existing diff component in the web app.

**Acceptance:** an operator sees a clear before/after for skill patches and memory updates, with the scope rationale and provisional badge.

## Task 12 — Wiring, settings, retire gated emitters, docs, verification · M

Close the loop and pay down the Phase-1 carry-forward.

- **Retire the templated emitters** (the EPIC end-state, now safe because the analyst replaces them): delete the gated `recordLearning` writes in `workflow-success-learner.listener.ts` and the failure aggregator's templated write (`workflow-failure-postmortem-learning-aggregator.service.ts`); keep the postmortem **segment** write + the recurrence **count** (now a gate signal). Remove the `learning_templated_emitters_enabled` plumbing (the shared `learning-emitters.settings.ts` helper) if fully unused.
- **Settings:** register all Phase-2 keys in `SYSTEM_SETTING_DEFAULTS` (see table below).
- **Module wiring:** confirm `WorkflowRetrospectiveModule` exports nothing that creates a cycle with `LearningModule`/`MemoryModule` (it _imports_ both); `LearningRouterService`/`PromotionGovernancePolicyService` register in `LearningModule`.
- **Docs:** update `docs/guide/35-memory-learning.md` (analyst, gate, drain, digest, routing, governance), the **Workflow Module Boundaries** table in CLAUDE.md, and the EPIC-212 progress table (mark Phase 2).

**Acceptance:** the templated emitters are gone; the analyst is the failure/success miner; settings seed on a fresh DB; docs reflect the new module.

## Verification & exit criteria

- `npm run build --workspace=packages/core` (new `RetrospectiveFinding` contract) → `npm run build:api` → `npm run build:web` succeed.
- `npm run test:api` + `npm run test:unit:web` green for all new/changed specs (targeted during iteration; full suite before PR).
- `npm run lint:api` / `npm run lint:web` clean — **no** `eslint-disable`/`@ts-ignore`; new services obey `max-lines:500`, `complexity ≤14`, interfaces in `*.types.ts`.
- Migration specs pass against the pgvector image; `retrospective_queue`, `learning_candidates.routing_target`, `memory_segments.governance_state` migrations are idempotent + registered.
- **Manual smoke (live stack):** trigger a failed run with a real `error_code` → a `retrospective_queue` row scores `high`/`bypass` → the analyst emits a root-cause+fix `memory` finding citing `evidence_event_ids` → the router re-derives confidence (struggle-backed ≤0.7) → it lands as a **project** `provisional` memory with a visible rationale. Trigger a struggle-on-success run → a **working-procedure skill proposal** appears (not a memory). Craft a cross-scope (≥3) lesson → routes **global** and does **not** auto-promote. Craft a credential fact → routes **project**, pinned, never global, secret value absent. Kill the analyst provider → the deterministic Phase-0/1 loop still runs (fail-soft).

## Settings introduced (Phase 2)

| Setting                                      | Default     | Purpose                                                                   |
| -------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| `retrospective_enabled`                      | `false`     | Master kill-switch; off = no enqueue/drain/analysis (Phase-0/1 loop only) |
| `retrospective_interest_floor`               | `0.4`       | Below this gate score, runs are `skipped` (no LLM)                        |
| `retrospective_drain_budget_per_window`      | `5`         | Max runs analyzed per drain tick (cost cap)                               |
| `retrospective_bypass_budget`                | `3`         | Separate cap for immediate high-signal-failure analysis                   |
| `retrospective_drain_cron`                   | `0 * * * *` | Drain schedule (operator-tunable)                                         |
| `retrospective_digest_max_tokens`            | `4000`      | Token cap for the analyst digest (cost lever)                             |
| `retrospective_confidence_struggle_cap`      | `0.7`       | Max re-derived confidence for struggle-backed findings                    |
| `retrospective_confidence_inference_cap`     | `0.45`      | Max re-derived confidence for pure-inference findings (< promotion floor) |
| `learning_router_global_min_scopes`          | `3`         | Distinct-scope count required for a `global` route                        |
| `governance_agent_preference_min_confidence` | `0.8`       | Auto-promote floor for `agent_preference`                                 |
| `governance_probation_days`                  | `14`        | Probation window stamped on `provisional` auto-promotions                 |

> `learning_templated_emitters_enabled` is **removed** in Task 12 (the emitters are deleted, not gated).

## Rollback

- Set `retrospective_enabled=false` — the entire analyst/gate/drain/router path is inert; the deterministic Phase-0/1 loop (struggle candidates, clustering, scoring, vector injection) is unaffected.
- `routing_target=null` candidates fall back to today's `project`-default promotion; `governance_state=null` segments are treated as legacy/confirmed — so un-setting routing is non-destructive.
- All three migrations are **additive** (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`); `down` drops the column/table. No data migration, no image change (pgvector already landed in Phase 1).
- The emitter deletion (Task 12) is the only non-additive change — keep it as the **last** commit so it can be reverted independently if the analyst underperforms in production.

## Carry-forwards

- **To Phase 3 (lifecycle + measurement):** the `governance_state='provisional'` + `probationUntil` stamps written in Tasks 9/10 are consumed by the Phase-3 **probation evaluator** in `MemoryMetricsRefreshService` (confirm or auto-revert bad auto-promotions). The Task-6 "dedup against known memory" seam is where Phase-3 `MemoryContradictionService` (supersede/version) hooks in. The re-derived confidence + `routing_target` become labels for the Phase-3 `FeedbackWeightTunerService`. Wire the terminal-outcome observer (convergence numerator) first, as the EPIC mandates.
- **To Phase 4 (skill durability):** the `skill_new`/`skill_patch` routes (Tasks 7/8/10) feed proposals into the `create_skill` pipeline — Phase 4 adds runtime `SkillValidationService` at `create_skill`/`update_skill`, reseed preservation (so analyst-authored skills survive restart), and `workflowId` threading into `resolveAssignedSkills`. Until Phase 4 lands, treat analyst-generated skills as provisional (the governance matrix already forces them through a human proposal).
