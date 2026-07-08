# Phase 0 — "See it work": Memory & Learning Loop Rebuild

**Epic:** [EPIC-212](../../epics/EPIC-212-memory-learning-loop-rebuild.md)
**Created:** 2026-06-25
**Status:** Ready to execute
**Scope:** One feature branch, ideally one PR. No migration. No LLM. No new module. Reversible behind a single setting.

## Goal

Within one workflow run, the operator **sees an agent create a memory** (announced in chat), the Learning tab **stops showing templated garbage**, and a successful run where the agent struggled-then-recovered produces a **real** candidate with before/after evidence — all without new infrastructure.

This phase directly resolves operator complaints #1 (agents never record) and #2 (only templated failure noise), and lays the first deterministic slice of success-mining.

## Non-Goals (Phase 0)

- **No pgvector / embeddings / DB-image change.** This phase is deliberately no-migration, no-infra. The pgvector switch (`postgres:18-alpine` → `pgvector/pgvector:pg18`), `CREATE EXTENSION vector`, the dimension-native `memory_embeddings` table, the frontend-configurable embedding-model config, and embedding-based retrieval all land in **Phase 1** ([pgvector/embeddings plan](2026-06-25-memory-learning-loop-phase-1-pgvector-embeddings.md)).
- No near-dup dedup (exact-fingerprint only) — embedding/lexical near-dup is Phase 1.
- No `MemorySignalsModule`, clustering, or scoring-column population — Phase 1.
- No LLM retrospective analyst, routing, or governance matrix — Phase 2.
- No `update_memory` tool — Phase 1.

## Pre-flight verification (do before writing code)

1. Confirm the exact base prompt-layer insertion point. The capture directive must reach **every** agent step. Locate the base-layer array in `apps/api/src/workflow/workflow-step-execution/` (candidate: `step-agent-system-prompt.helpers.ts` `baseLayers`); confirm it is unconditional and assembled for all agent steps. Record the file:line in this plan before editing.
2. Confirm `InternalToolExecutionContext` carries `scopeId` (and `agentProfileName`) at the `remember` call site — cross-check `record-learning.service.ts` scope resolution.
3. Confirm the deny-default workflows that need an explicit `remember` grant (search `tool_policy: default: deny` in `seed/workflows/`), and whether a shared default tool-policy exists.

## Task 0 — Transcript-parser spike (de-risk Pillar B) · S

**Why first:** the entire success-mining story (Pillar B, and Task 6 below) assumes the failed→recovered tool sequence is observable. Validate before committing.

- Pull 2–3 real `pi_session_trees` rows for known struggle runs via the `retrieve-session-logs` / `retrieve-debug-bundle` skills.
- Determine: the `jsonl_data` node shape, whether it is base64/gzip-encoded, and whether distillation has smoothed away the failed-then-recovered tool calls.
- **Decision gate:** if struggle sequences survive in `pi_session_trees`, the struggle detector may read them; if not, Task 6 reads **only** `event_ledger` tool/job events (which are append-only and not distilled). Document the chosen source + the node-shape contract in this file.

**Acceptance:** a written node-shape contract + a go/no-go on session-tree-based struggle detection. No production code.

### Task 0 — Spike outcome (resolved 2026-06-25, code-based investigation)

**Decision: `StruggleDetectorService` reads `event_ledger` exclusively. Session-tree path is NO-GO for Phase 0.**

**`event_ledger` node-shape contract** (`apps/api/src/runtime/database/entities/event-ledger.entity.ts`):

- Every agent tool call emits one row with `domain='tool'`, `event_name='tool.execution.completed'` (written by `emitToolExecutionLedgerCompat` in `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts`).
- Outcome column `outcome` ∈ `'success' | 'failure' | 'denied' | 'in_progress' | 'skipped'`; tool failure = `'failure'`, plus `error_code` / `error_message`.
- Tool name column: `tool_name`. Run scope: `workflow_run_id`. Ordering: `occurred_at` (timestamptz `@CreateDateColumn`; **no integer sequence column** — order by `occurred_at ASC`). Composite index `['workflow_run_id', 'occurred_at']` already exists.
- Reconstruct a struggle span with: `SELECT tool_name, outcome, occurred_at, error_code, error_message FROM event_ledger WHERE workflow_run_id=$run AND domain='tool' AND event_name='tool.execution.completed' ORDER BY occurred_at ASC`, then group by `tool_name` in app code for ≥2 `failure` followed by a `success`. The existing `EventLedgerToolExecutionCounter` (`apps/api/src/workflow/event-ledger-tool-execution-counter.ts`) already demonstrates the query pattern; `EventLedgerRepository.query()` supports `workflow_run_id` / `outcome` / `tool_name` filters.

**Why session-tree is NO-GO:** `pi_session_trees.jsonl_data` is a `jsonb` array holding a single **base64(gzip(JSONL))** blob (decode pattern at `distillation.consumer.ts:63–66`); tool outcome is only implicit inside `tool_result` node content (no normalized enum); and the async distillation BullMQ job can rewrite the blob before detection runs (narrow TOCTOU). `event_ledger` is append-only, never mutated, and normalized — strictly better.

**Refinements that override stale Phase-0 plan assumptions (carry into the task briefs):**

1. **Corrected anchors:** success-listener `recordLearning` call is at `workflow-success-learner.listener.ts:161` inside `processCompletedRun` (not :259); postmortem templated `recordLearning` is at `workflow-failure-postmortem-learning-aggregator.service.ts:138` inside `maybeProposeLearningCandidate` (not :213). The postmortem `memory_segments` write lives in a separate listener (`WorkflowFailurePostmortemListener`), so gating the aggregator's candidate write does not touch it; the recurrence `count` (aggregator line ~109) is kept.
2. **`REMEMBER_RUNTIME_CAPABILITY` is split:** the `rememberBodySchema` goes in `packages/core` (next to `recordLearningBodySchema` at `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts:167`); the `REMEMBER_RUNTIME_CAPABILITY` constant goes in `apps/api/src/workflow/workflow-runtime/workflow-runtime-capability.contracts.ts` (next to `RECORD_LEARNING_RUNTIME_CAPABILITY`, added to `WORKFLOW_RUNTIME_CAPABILITY_DEFINITIONS`).
3. **`candidate_type` is hardcoded** as `'runtime_learning'` in `record-learning.service.ts:13`; `createCandidateOrReadDuplicate` has no override. Task 2 must add optional overrides (`candidate_type`, `source_quality_confidence`, `human_approved_at`, `signals_json`) to the service path; Task 6 reuses them for `candidate_type='struggle'`.
4. **No existing sweep/CEO base-layer exclusion.** `baseLayers` (`step-agent-system-prompt.helpers.ts:91–99`) is unconditional; `agentProfileId` alone can't exclude the sweep (it runs as `ceo-agent` too). Task 3 should compute a `suppressMemoryCapture` boolean **upstream** where workflow identity is known and pass it into the pure helper, rather than plumbing `workflow_id` deep into the helper. (Belt-and-suspenders only: `remember` is not granted to the sweep/CEO workflows anyway, so the directive is inert there even if present.)
5. **`memory/signals/` does not exist** — create it; register `TemplateNoiseClassifier` + `StruggleDetectorService` in `MemoryModule.providers` (not `LearningModule`, to avoid the existing `forwardRef` circular-dep). `InternalToolExecutionContext` (`packages/core/src/interfaces/internal-tool.types.ts:37–44`) carries `scopeId`, `agentProfileName`, `workflowRunId`, `jobId`.

## Task 1 — Kill the two templated emitters (reversible) · S

**TDD:**

- _Red:_ test asserting that with `learning_templated_emitters_enabled=false` (the default), `WorkflowSuccessLearnerListener.processCompletedRun` does **not** call `RecordLearningService.recordLearning`, and `WorkflowPostmortemLearningAggregatorService.maybeProposeLearningCandidate` returns `{proposed:false, reason:'emitter_disabled'}` without calling `recordLearning`.
- _Green:_ gate both candidate writes behind a `SystemSettingsService` flag `learning_templated_emitters_enabled` (default `false`). **Keep** the postmortem `memory_segments` write and the recurrence count in the aggregator (they become Phase-2 gate signals).
- _Refactor:_ extract the flag read to a small shared helper mirroring `resolveThresholds`.

**Files:** `workflow-success-learner.listener.ts`, `workflow-failure-postmortem-learning-aggregator.service.ts`, `apps/api/src/settings/system-settings.defaults.ts`.

**Note:** the EPIC's end-state is _deletion_ of these candidate writes (aggressive-hygiene mandate). Phase 0 gates them off for a safe, reversible rollout; the deletion lands once Phase 1 ranking is proven (a follow-up hygiene commit).

## Task 2 — `remember` tool → fast-tracked candidate · M

**Contract (`packages/core`):** add `REMEMBER_RUNTIME_CAPABILITY` + `rememberBodySchema` next to `RECORD_LEARNING_RUNTIME_CAPABILITY`. **Strict-provider rule:** flat/closed JSON schema, no `oneOf`, all optionals defaulted.

```jsonc
// remember — agent-facing surface (agent never passes entity IDs)
{
  "content": "string (required, 20..2000)",
  "memory_type": "fact | preference | history   (default fact)",
  "scope": "project | global                     (default project)",
  "tags": ["string"],                            // optional, lowercased
  "origin": "discovery | user_request            (default discovery)",
  "confidence": 0.0..1.0                          // optional, default from setting
}
```

**TDD (handler):**

- _Red:_ `MemoryToolsHandler.remember(context, params)` test — resolves `scope_type/scope_id` from `context.scopeId`; creates a `learning_candidate` via `RecordLearningService` with `candidate_type='agent_capture'`, a high `source_quality_confidence` prior, provenance `{captured_by, workflow_run_id, job_id}`; `origin:'user_request'` sets `human_approved_at`; exact-fingerprint duplicate returns `{created:false, candidate_id}` and reinforces (does not insert).
- _Green:_ implement `remember.tool.ts` (`IInternalToolHandler`, mirrors `record-learning.tool.ts`) + `MemoryToolsHandler.remember()`.
- _Refactor:_ share normalization/fingerprint with `record-learning.service.ts`.

**Birth-path note (locked decision):** `remember` writes a **candidate**, not a `memory_segment`. This gives every memory one birth path + scope inference + the credentials-never-global rail + uniform dedup. `origin:user_request` → `human_approved_at` so Phase-0 promotion (existing path) surfaces it near-instantly; until Phase 2 governance lands, agent `discovery` captures sit as pending candidates visible in the tab.

**Files:** ADD `tools/memory/remember.tool.ts`, `packages/core` capability+schema; EXTEND `memory-tools.handler.ts`, register the tool.

## Task 3 — Always-on prompt directive · S

**TDD:**

- _Red:_ test asserting the assembled base system prompt for a normal agent step contains the `memory-capture-guidance` section, and that it is **absent** for the sweep/CEO singleton workflows.
- _Green:_ add `{ id: 'memory-capture-guidance', content: MEMORY_CAPTURE_GUIDANCE }` to the base-layer array; const in a new `step-support-memory-capture.helpers.ts`.

**Directive content (final text):**

```md
## Recording what you learn (memory capture)

Use the `remember` tool the moment you learn something a future agent on THIS
project would waste time rediscovering. Recording is cheap and deduplicated —
when in doubt, record.

RECORD when you:

- Hit a non-obvious gotcha ("the dev DB only accepts the `nexus_dev` role over
  port 5433"; "lint stops on the first failing workspace — use lint:summary").
- Discover a hard-won fact after trial and error (how to retrieve session logs,
  which env var controls X, an undocumented build step).
- Are told something specific by the user ("always use cross-env for scripts") —
  set scope:"global", origin:"user_request", and ALSO tell the user you recorded it.
- Find a constraint or invariant that wasn't written down.

Do NOT record:

- Transient run state, task progress, or todo items (use the todo tool).
- Secrets, tokens, credentials, or PII — never the secret value itself.
- Things already obvious from the code or already in your injected context.
- Speculation — record facts you verified, not guesses.

Keep each memory one self-contained fact in 1–3 sentences.
```

**Files:** ADD `step-support-memory-capture.helpers.ts`; EXTEND the base-layer assembly.

## Task 4 — Default grants + contract test · S

- Add `{ effect: 'allow', tool: 'remember' }` to 3–4 high-traffic profiles (`junior_dev`, `senior_dev`, `architect-agent`, + one research profile) in `seed/agents/*/agent.json`, and to their deny-default workflow `tool_policy` blocks.
- **Contract test** asserting `remember` survives `jobScoped ∩ profileAllowed` for those profiles (reuse the pattern from the "Todo tools stripped by job-scope policy" fix).

## Task 5 — `TemplateNoiseClassifier` (sweep-queue filter) · S

**TDD:**

- _Red:_ pure-function test — `classifyTemplateNoise(candidate)` returns `isTemplate:true` for the two literal templates (`^Recurring .+ failures \(\d+ occurrences in \d+ days\)$`, `^Workflow run [0-9a-f-]{36} for scope .+ completed cleanly in \d+s`) and `isLowSignal:true` for lessons with no file/table/tool/command/credential/imperative-verb anchor.
- _Green:_ implement the classifier; `list_pending_learning_candidates` excludes template-classified rows from the sweep queue (they still count toward recurrence later).

**Files:** ADD `template-noise.classifier.ts` (placed in `apps/api/src/memory/signals/` as the seed of `MemorySignalsModule`, even though the full module lands in Phase 1); EXTEND the sweep candidate listing.

## Task 6 — No-LLM struggle candidate · M (source per Task 0 gate)

**TDD:**

- _Red:_ `StruggleDetectorService.detect(runId)` test over a fixture event stream — detects ≥2 `outcome:failure` on the same `tool_name` followed by `outcome:success`; emits `StruggleSpan { tool, failedAttempts, recoveringCall, errorCodes }`.
- _Green:_ on `WORKFLOW_RUN_COMPLETED_EVENT`, if ≥1 struggle span, write a candidate (`candidate_type='struggle'`, `tags:['struggle_backed']`) whose evidence carries the failed commands + the recovering command. Source = `event_ledger` (Task 0 may upgrade to session-tree).
- _Refactor:_ the detector lives in `apps/api/src/memory/signals/` (shared owner per the consolidation principle); Phase 1 reuses it for the interest gate.

**Files:** ADD `apps/api/src/memory/signals/struggle-detector.service.ts` (+ minimal `MemorySignalsModule` shell or temporary registration in the memory module), `EventLedgerRepository` ordered-tool-event helper.

## Verification & exit criteria

- `npm run test:api` green for all new/changed specs (run targeted specs during iteration, full suite before PR).
- `npm run lint:api` clean — **no** `eslint-disable`/`@ts-ignore`.
- `npm run build --workspace=packages/core` then `npm run build:api` succeed (new core contract).
- **Manual smoke (live stack):** trigger a workflow where an agent hits a gotcha → confirm (a) the agent calls `remember` and announces it, (b) the candidate appears in the Learning tab, (c) `origin:user_request` captures show as approved/promoted, (d) the tab shows no `"Recurring … failures"` rows, (e) a known struggle-on-success run yields a `struggle_backed` candidate with real evidence.
- Update `docs/guide/35-memory-learning.md` (new `remember` tool + capture directive + emitter flag) and the EPIC-212 progress table.

## Settings introduced (Phase 0)

| Setting                               | Default | Purpose                                                                |
| ------------------------------------- | ------- | ---------------------------------------------------------------------- |
| `learning_templated_emitters_enabled` | `false` | Master kill-switch for the two templated candidate writes (reversible) |
| `memory_capture_default_confidence`   | `0.6`   | Write-time prior for `remember` discovery captures                     |
| `memory_capture_max_per_job`          | `8`     | Per-job `remember` budget (enforced fully in Phase 1)                  |

## Rollback

Set `learning_templated_emitters_enabled=true` to restore prior emitter behaviour; ungrant `remember` in the profile seeds to disable capture. No schema changes to revert.
