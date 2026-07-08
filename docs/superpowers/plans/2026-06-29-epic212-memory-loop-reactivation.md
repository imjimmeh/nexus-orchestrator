# EPIC-212 Memory/Learning Loop Reactivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-deployed EPIC-212 loop actually produce useful project memories/learnings by (A) turning on the real-input engines that ship default-off, (B) removing the templated noise that still floods the queue, and (C) fixing the agent self-capture path that has never fired — and clear the existing polluted learning data from the active project.

**Architecture:** EPIC-212 is fully built, merged to `origin/main`, deployed (nexus-api rebuilt 2026-06-29 00:57, pgvector image live) and booting cleanly. Nothing is broken structurally. The loop is _inert and polluted_: the LLM retrospective analyst is off (`retrospective_enabled=false`), no embedding model is configured (0 embeddings), agent `remember` has never produced a row (0 `agent_capture` candidates ever — the subagent prompt path omits the capture directive), while a templated Kanban "orchestration cycle" producer plus the postmortem writer keep generating content-free rows. This plan flips the engines on, gates/relabels the noise, fixes the subagent directive, and purges the existing junk for project `458935f0`.

**Tech Stack:** NestJS (apps/api, apps/kanban), TypeORM, Postgres (pgvector/pgvector:0.8.3-pg18), BullMQ, Vitest, React (apps/web). System settings via `SystemSettingsService`. AI/embedding config via `AiConfigurationService` + `/ai-config/models`.

## Global Constraints

- **Active project under repair:** `458935f0-213e-4bbe-89d1-8883e0efa9ad` (746/786 recent candidates land here).
- **Live DB:** container `nexus-postgres`, db `nexus_orchestrator`, user `nexus`, password `nexus_password`, port 5433. Connect via `docker exec -e PGPASSWORD=nexus_password nexus-postgres psql -U nexus -d nexus_orchestrator`.
- **No eslint suppression, no `@ts-ignore`, no rule downgrades** (project strict-lint policy).
- **Core/Kanban boundary:** `apps/api/src` and `packages/core/src` stay Kanban-neutral. New gating of the Kanban templated producer lives at the **API consumer** listener (which already owns settings + classifier), not by teaching API the Kanban domain.
- **TDD (Red-Green-Refactor)** for every code change. Run the single targeted test, watch it fail, implement minimally, watch it pass, commit.
- **All new behaviour flag-gated and default-OFF** unless the task explicitly flips an existing operator switch.
- **Build order:** `npm run build --workspace=packages/core` before api/kanban builds when contracts change.
- **Verify branch before commit:** `git branch --show-current` (concurrent agents move HEAD in this repo).
- **Typecheck/lint/test before declaring a task done:** `npm run test:api` (or targeted), `npm run lint:api`.

---

## File Structure

| File                                                                                                     | Responsibility                                                               | Task    |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------- |
| `docs/superpowers/plans/2026-06-29-epic212-memory-loop-reactivation.md`                                  | This plan                                                                    | —       |
| `scripts/ops/purge-project-learning-data.sql` (new)                                                      | Transactional, backup-first purge of one project's learning/memory rows      | Task 0  |
| (operator action, no file)                                                                               | Configure embedding model in `/ai-config/models`                             | Task A1 |
| (operator action, no file)                                                                               | `PUT /system-settings/retrospective_enabled {"value":true}`                  | Task A2 |
| `apps/api/src/settings/kanban-retrospective-candidate.settings.constants.ts` (new)                       | Setting key + default for gating the Kanban cycle producer                   | Task B1 |
| `apps/api/src/settings/system-settings.defaults.ts` (modify)                                             | Register the new setting fragment                                            | Task B1 |
| `apps/api/src/memory/learning/learning-candidate-proposal.listener.ts` (modify)                          | Drop `kanban_project` templated lessons when the gate is off                 | Task B1 |
| `apps/api/src/memory/signals/template-noise.classifier.ts` (modify)                                      | Add the orchestration-cycle regex                                            | Task B2 |
| (operator action, no file)                                                                               | `PUT /system-settings/workflow_postmortem_writeback_enabled {"value":false}` | Task B3 |
| `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts` (modify) | Inject `MEMORY_CAPTURE_GUIDANCE` into subagent system prompt                 | Task C2 |

---

## Task 0: Back up and purge the active project's polluted learning data

**Why:** The Learning tab is dominated by 1,133 candidates (overwhelmingly templated `runtime_learning` rejects) + 108 project memory_segments (mostly templated postmortems) for project `458935f0`. The user asked to clear these. Do it backup-first and transactional so it's reversible. Run this **after** Task B1/B2 are deployed (so the noise does not immediately repopulate), but the script itself is independent.

**Files:**

- Create: `scripts/ops/purge-project-learning-data.sql`

**Delete order (respects the single FK `skill_improvement_proposals.learning_candidate_id → learning_candidates.id ON DELETE SET NULL`; all other refs are FK-less by design):** embeddings → segment_feedback → skill_proposals → retrospective_queue → runtime_feedback_signal_groups → learning_candidates → memory_segments. **`signal_weight_history` is GLOBAL — never delete it.**

- [ ] **Step 1: Snapshot the to-be-deleted rows to backup tables (reversible)**

Create `scripts/ops/purge-project-learning-data.sql`:

```sql
-- Purge polluted learning/memory data for one project. Backup-first + transactional.
-- Usage: docker exec -e PGPASSWORD=nexus_password -i nexus-postgres \
--   psql -U nexus -d nexus_orchestrator -v pid="'458935f0-213e-4bbe-89d1-8883e0efa9ad'" \
--   -f - < scripts/ops/purge-project-learning-data.sql
\set ON_ERROR_STOP on
BEGIN;

-- Resolve the working sets once into temp tables.
CREATE TEMP TABLE _cand AS
  SELECT id FROM learning_candidates
  WHERE scope_type IN ('project','kanban_project') AND scope_id = :pid;
CREATE TEMP TABLE _seg AS
  SELECT id FROM memory_segments
  WHERE entity_type = 'project' AND entity_id = :pid;

-- Timestamped backups (suffix is fixed here; rename if you run repeatedly).
CREATE TABLE IF NOT EXISTS _bak_learning_candidates_458935f0 AS
  SELECT * FROM learning_candidates WHERE id IN (SELECT id FROM _cand);
CREATE TABLE IF NOT EXISTS _bak_memory_segments_458935f0 AS
  SELECT * FROM memory_segments WHERE id IN (SELECT id FROM _seg);
CREATE TABLE IF NOT EXISTS _bak_skill_proposals_458935f0 AS
  SELECT * FROM skill_improvement_proposals WHERE learning_candidate_id IN (SELECT id FROM _cand);

SELECT 'pre-delete candidates' AS label, count(*) FROM _cand
UNION ALL SELECT 'pre-delete segments', count(*) FROM _seg;
```

- [ ] **Step 2: Append the ordered deletes inside the same transaction**

```sql
DELETE FROM memory_embeddings
  WHERE (owner_type='learning_candidate' AND owner_id IN (SELECT id FROM _cand))
     OR (owner_type='memory_segment'    AND owner_id IN (SELECT id FROM _seg));

DELETE FROM memory_segment_feedback
  WHERE segment_id IN (SELECT id FROM _seg);

DELETE FROM skill_improvement_proposals
  WHERE learning_candidate_id IN (SELECT id FROM _cand);

DELETE FROM retrospective_queue
  WHERE scope_id = :pid;

DELETE FROM runtime_feedback_signal_groups
  WHERE (scope_type IN ('project','kanban_project') AND scope_id = :pid)
     OR (candidate_id IN (SELECT id FROM _cand));

DELETE FROM learning_candidates
  WHERE id IN (SELECT id FROM _cand);

DELETE FROM memory_segments
  WHERE id IN (SELECT id FROM _seg);

SELECT 'post-delete candidates' AS label,
       (SELECT count(*) FROM learning_candidates WHERE scope_type IN ('project','kanban_project') AND scope_id = :pid) AS n
UNION ALL SELECT 'post-delete segments',
       (SELECT count(*) FROM memory_segments WHERE entity_type='project' AND entity_id = :pid);

COMMIT;
```

- [ ] **Step 3: Dry-run the counts (no delete) to confirm the working set**

Run:

```bash
docker exec -e PGPASSWORD=nexus_password nexus-postgres psql -U nexus -d nexus_orchestrator -c "
SELECT 'candidates' AS t, count(*) FROM learning_candidates WHERE scope_type IN ('project','kanban_project') AND scope_id='458935f0-213e-4bbe-89d1-8883e0efa9ad'
UNION ALL SELECT 'segments', count(*) FROM memory_segments WHERE entity_type='project' AND entity_id='458935f0-213e-4bbe-89d1-8883e0efa9ad';"
```

Expected: candidates ≈ 1133, segments ≈ 108.

- [ ] **Step 4: Execute the purge**

Run:

```bash
docker exec -e PGPASSWORD=nexus_password -i nexus-postgres psql -U nexus -d nexus_orchestrator \
  -v pid="'458935f0-213e-4bbe-89d1-8883e0efa9ad'" -f - < scripts/ops/purge-project-learning-data.sql
```

Expected: `post-delete candidates = 0`, `post-delete segments = 0`, `COMMIT`.

- [ ] **Step 5: Confirm the Learning tab is empty for the project, then commit the script**

```bash
git add scripts/ops/purge-project-learning-data.sql
git commit -m "ops(memory): backup-first purge script for a project's polluted learning data"
```

**Rollback:** `INSERT INTO learning_candidates SELECT * FROM _bak_learning_candidates_458935f0;` (and the segment/proposal backups). Drop the `_bak_*` tables once satisfied.

---

## Track A — Turn on the real-input engines (operator/config; reversible; no merge)

### Task A1: Configure an active embedding model and verify backfill

**Why:** `memory_embeddings` has 0 rows and no `llm_models` row has `default_for_embedding=true`. Without it, `EmbeddingProviderService.embed()` early-returns `{configured:false}`, so there is no semantic dedup (the 714 near-dup templated rows never collapse), no clustering, and `memory_retrieval_mode='hybrid'` silently degrades to recency. Embeddings are strictly opt-in: configuring the model is the sole enable signal.

**Interfaces (already built — operator action only):**

- Resolve path: `AiConfigurationService.resolveEmbeddingModelConfig()` → `LlmModelRepository.findDefaultForEmbedding()` (`is_active=true AND default_for_embedding=true LIMIT 1`).
- On save, `AiConfigAdminService.updateModel()` emits `EMBEDDING_ACTIVE_MODEL_CHANGED_EVENT`; `EmbeddingReindexService.reindexActiveModel()` drives `EmbeddingBackfillService.run()` until the corpus is embedded, then prunes old-model rows.

- [ ] **Step 1: Pick a provider/model.** Anthropic has no embeddings API → use Voyage (Claude-native path) or any OpenAI-compatible endpoint. Ensure the provider exists in `/providers` with a valid `secret_store` credential (and `runtime_env.base_url` if self-hosted).

- [ ] **Step 2: In `/ai-config/models`, edit/create the embedding model** and set (ModelForm `EmbeddingFields`): `supports_embedding=true`, `embedding_dimension` = the model's native dim (e.g. 1024 for voyage-3, 1536 for text-embedding-3-small), `default_for_embedding=true`. Save (issues `PATCH /ai-config/models/{id}`, permission `agents:manage`).

- [ ] **Step 3: Watch the reindex** in nexus-api logs (`docker logs nexus-api -f | grep -i EmbeddingReindex`). Expect backfill batches over `memory_segment` + `learning_candidate` owners.

- [ ] **Step 4: Verify embeddings exist**

Run:

```bash
docker exec -e PGPASSWORD=nexus_password nexus-postgres psql -U nexus -d nexus_orchestrator -c "
SELECT owner_type, count(*), count(distinct model_id) FROM memory_embeddings GROUP BY 1;"
```

Expected: non-zero rows for both owner types, exactly one `model_id`.

**Note:** There is no public backfill endpoint. If the automatic reindex does not fire (e.g. event missed), the fallback is invoking `EmbeddingBackfillService.run()` via a one-off admin path — out of scope here; the model-change event is the supported trigger.

### Task A2: Enable the retrospective analyst loop

**Why:** `retrospective_enabled=false` (default). `RetrospectiveEnqueueListener` early-returns and `RetrospectiveDrainService.drainWindow()` no-ops, so `retrospective_queue` stays empty and no real root-cause+fix / working-procedure lessons are ever mined. This is the single biggest source of _real_ learnings. It is budget-capped (`retrospective_drain_budget_per_window=5`, `retrospective_bypass_budget=3`) so cost is bounded.

- [ ] **Step 1: Flip the master switch**

Run (requires `settings:manage`; substitute a valid admin token, or do the DB mutation in Step 1b):

```bash
curl -X PUT http://localhost:3010/api/system-settings/retrospective_enabled \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"value": true}'
```

- [ ] **Step 1b (fallback if no token handy): DB mutation**

```bash
docker exec -e PGPASSWORD=nexus_password nexus-postgres psql -U nexus -d nexus_orchestrator -c "
UPDATE system_settings SET value='true'::jsonb WHERE key='retrospective_enabled';"
```

- [ ] **Step 2: Trigger terminal runs and confirm enqueue.** After the next completed/failed run, verify the queue populates and the hourly drain (`retrospective-drain.run`, cron `0 * * * *`) consumes it:

```bash
docker exec -e PGPASSWORD=nexus_password nexus-postgres psql -U nexus -d nexus_orchestrator -c "
SELECT status, count(*) FROM retrospective_queue GROUP BY 1;"
```

Expected: rows appear (was 0). After a drain window, statuses progress past `pending`.

- [ ] **Step 3: Confirm a real finding lands** as an `agent_capture`/analyst-routed candidate or skill proposal scoped to the project (not templated). This is the acceptance signal for "real learnings return."

---

## Track B — Remove the templated noise that still floods the loop

### Task B1: Gate the Kanban orchestration-cycle templated candidate at the API consumer

**Why:** `KanbanRetrospectiveService` emits `learning.candidate.proposed.v1` with the templated lesson _"Kanban project X completed an orchestration cycle with N done…"_ (`kanban-retrospective-candidate.helpers.ts:48`) on every cycle. The API consumer `LearningCandidateProposalListener` turns it into a `runtime_learning` candidate (714/7d, all rejected). EPIC-212 left the Kanban producer untouched; gate it at the **API consumer** (which already owns `SystemSettingsService` + the classifier) so we stay Kanban-neutral and stop the row at birth.

**Files:**

- Create: `apps/api/src/settings/kanban-retrospective-candidate.settings.constants.ts`
- Modify: `apps/api/src/settings/system-settings.defaults.ts`
- Modify: `apps/api/src/memory/learning/learning-candidate-proposal.listener.ts`
- Test: `apps/api/src/memory/learning/learning-candidate-proposal.listener.spec.ts`

**Interfaces:**

- Produces: setting key `kanban_retrospective_candidate_enabled` (default `false`); listener early-returns (no `recordLearning`) when the payload's `scope_type === 'kanban_project'` AND the lesson matches the orchestration-cycle template AND the setting is off.

- [ ] **Step 1: Write the failing test** in `learning-candidate-proposal.listener.spec.ts`:

```typescript
it("drops kanban orchestration-cycle templated lessons when the gate is disabled (default)", async () => {
  settings.get.mockResolvedValue(false); // kanban_retrospective_candidate_enabled default off
  await listener.handleLearningCandidateProposed({
    scope_type: "kanban_project",
    scope_id: "proj-1",
    lesson:
      "Kanban project proj-1 completed an orchestration cycle with 2 done items, 0 blocked items, and cycle decision repeat.",
    evidence: [],
    confidence: 0.6,
    tags: ["kanban", "retrospective", "orchestration-cycle"],
  } as never);
  expect(recordLearningService.recordLearning).not.toHaveBeenCalled();
});

it("still records non-templated kanban lessons", async () => {
  settings.get.mockResolvedValue(false);
  await listener.handleLearningCandidateProposed({
    scope_type: "kanban_project",
    scope_id: "proj-1",
    lesson:
      "Splitting work items by acceptance criterion before dispatch avoided the overlapping-AC failure.",
    evidence: [],
    confidence: 0.6,
    tags: ["kanban"],
  } as never);
  expect(recordLearningService.recordLearning).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`recordLearning` is called for the templated case).

Run: `npm run test:api -- learning-candidate-proposal.listener.spec`

- [ ] **Step 3: Add the setting constants** in `apps/api/src/settings/kanban-retrospective-candidate.settings.constants.ts` (mirror `retrospective-enabled.settings.ts` shape):

```typescript
export const KANBAN_RETROSPECTIVE_CANDIDATE_ENABLED_KEY =
  "kanban_retrospective_candidate_enabled";
export const KANBAN_RETROSPECTIVE_CANDIDATE_ENABLED_DEFAULT = false;
export const KANBAN_RETROSPECTIVE_CANDIDATE_SYSTEM_SETTING_DEFAULTS = {
  [KANBAN_RETROSPECTIVE_CANDIDATE_ENABLED_KEY]: {
    value: KANBAN_RETROSPECTIVE_CANDIDATE_ENABLED_DEFAULT,
    description:
      'When false (default) the API drops the templated Kanban "completed an orchestration cycle" learning candidate at ingestion. Set true only to restore the legacy templated producer.',
  },
} as const;
// Reuse the same orchestration-cycle regex as the classifier (Task B2) to keep one source of truth.
export const KANBAN_ORCHESTRATION_CYCLE_TEMPLATE =
  /^Kanban project .+ completed an orchestration cycle with \d+ done items?, \d+ blocked items?, and cycle decision .+\.$/;
```

- [ ] **Step 4: Register the fragment** in `system-settings.defaults.ts` (import + spread into `SYSTEM_SETTING_DEFAULTS`, mirroring the `retrospective-enabled` import at line ~110 and spread at ~560).

- [ ] **Step 5: Implement the gate** in `learning-candidate-proposal.listener.ts` `handleLearningCandidateProposed()`, before the `recordLearning` call:

```typescript
const gateOn =
  (await this.settings.get<unknown>(
    KANBAN_RETROSPECTIVE_CANDIDATE_ENABLED_KEY,
    KANBAN_RETROSPECTIVE_CANDIDATE_ENABLED_DEFAULT,
  )) === true;
if (
  !gateOn &&
  payload.scope_type === "kanban_project" &&
  KANBAN_ORCHESTRATION_CYCLE_TEMPLATE.test(payload.lesson ?? "")
) {
  this.logger.debug(
    `Dropping templated kanban orchestration-cycle lesson for scope ${payload.scope_id}`,
  );
  return;
}
```

(Inject `SystemSettingsService` into the listener constructor if not already present.)

- [ ] **Step 6: Run the tests — expect PASS.** `npm run test:api -- learning-candidate-proposal.listener.spec`

- [ ] **Step 7: Lint + commit**

```bash
npm run lint:api
git add apps/api/src/settings/kanban-retrospective-candidate.settings.constants.ts apps/api/src/settings/system-settings.defaults.ts apps/api/src/memory/learning/learning-candidate-proposal.listener.ts apps/api/src/memory/learning/learning-candidate-proposal.listener.spec.ts
git commit -m "fix(memory): gate templated kanban orchestration-cycle learning candidate at ingestion (EPIC-212 noise hygiene)"
```

### Task B2: Teach `TemplateNoiseClassifier` the orchestration-cycle template

**Why:** Belt-and-suspenders for any orchestration-cycle rows that bypass B1 (historical rows, or if the gate is ever re-enabled). The classifier already floors `source_quality_confidence` and routes `drop` for templated/low-signal rows; it just lacks this regex (it has `RECURRING_FAILURES_TEMPLATE` and `WORKFLOW_COMPLETED_CLEANLY_TEMPLATE` only).

**Files:**

- Modify: `apps/api/src/memory/signals/template-noise.classifier.ts`
- Test: `apps/api/src/memory/signals/template-noise.classifier.spec.ts`

- [ ] **Step 1: Write the failing test**:

```typescript
it("classifies the kanban orchestration-cycle template as low-signal noise", () => {
  const r = classifyTemplateNoise({
    title: "Kanban project proj-1 completed an orchestration cycle",
    summary:
      "Kanban project proj-1 completed an orchestration cycle with 2 done items, 0 blocked items, and cycle decision repeat.",
  });
  expect(r.isTemplate).toBe(true);
  expect(r.isLowSignal).toBe(true);
});
```

- [ ] **Step 2: Run it — expect FAIL.** `npm run test:api -- template-noise.classifier.spec`

- [ ] **Step 3: Add the regex** next to the existing templates and include it in the template-match check:

```typescript
const ORCHESTRATION_CYCLE_TEMPLATE =
  /^Kanban project .+ completed an orchestration cycle with \d+ done items?, \d+ blocked items?, and cycle decision .+\.$/;
// in the matcher: isTemplate = RECURRING_FAILURES_TEMPLATE.test(s) || WORKFLOW_COMPLETED_CLEANLY_TEMPLATE.test(s) || ORCHESTRATION_CYCLE_TEMPLATE.test(s);
```

- [ ] **Step 4: Run — expect PASS. Commit.**

```bash
npm run test:api -- template-noise.classifier.spec && npm run lint:api
git add apps/api/src/memory/signals/template-noise.classifier.ts apps/api/src/memory/signals/template-noise.classifier.spec.ts
git commit -m "fix(memory): TemplateNoiseClassifier recognizes the kanban orchestration-cycle template"
```

### Task B3: Stop the postmortem direct-to-memory writeback (config)

**Why:** `WorkflowFailurePostmortemListener` writes a pinned templated `memory_segment` (`source='workflow_failure_postmortem'`, content like _"Recurring ambiguous_failure failures (26 occurrences)"_) on every failed run — 105/7d on the project. These are the "memories" the user sees as junk. The listener already has a kill switch `workflow_postmortem_writeback_enabled` (default `true`), checked at `workflow-failure-postmortem.listener.ts:186-192`.

- [ ] **Step 1: Disable the writeback**

```bash
docker exec -e PGPASSWORD=nexus_password nexus-postgres psql -U nexus -d nexus_orchestrator -c "
UPDATE system_settings SET value='false'::jsonb WHERE key='workflow_postmortem_writeback_enabled';"
```

(or `PUT /system-settings/workflow_postmortem_writeback_enabled {"value": false}`)

- [ ] **Step 2: Verify no new postmortem segments after the next failed run**

```bash
docker exec -e PGPASSWORD=nexus_password nexus-postgres psql -U nexus -d nexus_orchestrator -c "
SELECT count(*) FROM memory_segments WHERE source='workflow_failure_postmortem' AND created_at > now() - interval '1 hour';"
```

Expected: 0.

**Decision note for the user:** This removes failure postmortems from memory entirely. The richer alternative (Track A's retrospective analyst) replaces them with _real_ root-cause+fix lessons. If you want to keep postmortems as non-injected evidence instead of deleting them, that is a follow-up code change (relabel so they don't surface on the Learning tab) — out of scope here.

---

## Track C — Make agent self-capture (`remember`) actually fire

### Task C1: Verify on a live run _why_ `remember` has never fired

**Why:** 0 `agent_capture` rows ever, despite tool + profile + workflow grants + an unconditionally-injected step directive. Two leading causes: (i) the **subagent prompt path omits `MEMORY_CAPTURE_GUIDANCE`** (confirmed gap — see C2), and/or (ii) the tool is not materializing in the harness catalog, and/or (iii) purely behavioural. Gather evidence before/while fixing C2.

- [ ] **Step 1: Check whether `remember` was ever even attempted** (rules out "tool present but agents ignore it"):

```bash
docker exec -e PGPASSWORD=nexus_password nexus-postgres psql -U nexus -d nexus_orchestrator -c "
SELECT count(*) FROM event_ledger WHERE tool_name='remember';"
```

Expected today: 0. If >0 → agents call it but the write fails (investigate the handler/recordLearning path instead).

- [ ] **Step 2: Confirm tool materialization.** Ensure SDK tool-allowlist diagnostics are persisted (`NEXUS_PERSIST_SDK_TOOL_ALLOWLIST` defaults true; written by `tool-mounting.service.ts:150-157` to `storage/tool-runtime/sdk-allowlists/{run}-{job}-{step}.json`). Pick a recent implement/work-item run and grep its allowlist JSON for `"remember"`. Present in step jobs, absent in subagent jobs ⇒ confirms the materialization/divergence split.

- [ ] **Step 3: Inspect the actual prompt** via the `retrieve-session-logs` skill for a recent work-item run; confirm whether `MEMORY_CAPTURE_GUIDANCE` text is in the system prompt for (a) the step agent and (b) any spawned subagent. Record the finding in the run notes — it decides whether C3 is needed.

### Task C2: Inject `MEMORY_CAPTURE_GUIDANCE` into the subagent system prompt

**Why:** `buildSubagentSystemPrompt()` (`subagent-orchestrator.container-config.operations.ts:201-244`) appends only skill content to the profile base prompt — it never adds the capture directive that the step path adds (`step-agent-system-prompt.helpers.ts:101-103`). Subagents do the bulk of implementation work, so they are the agents most likely to discover gotchas worth remembering, yet they are never told to. This is the most concrete fixable cause of "zero captures."

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts`
- Test: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.spec.ts` (create if absent)

**Interfaces:**

- Consumes: `MEMORY_CAPTURE_GUIDANCE`, `shouldSuppressMemoryCapture(workflowId)` from `step-support-memory-capture.helpers.ts`.
- Produces: subagent system prompt that includes the capture directive unless the workflow is in the suppression list.

- [ ] **Step 1: Write the failing test**:

```typescript
it("includes the memory-capture guidance in the subagent system prompt", () => {
  const prompt = buildSubagentSystemPrompt({
    basePrompt: "You are a senior dev subagent.",
    skillContent: "",
    workflowId: "work-item-in-progress-default",
  } as never);
  expect(prompt).toContain(MEMORY_CAPTURE_GUIDANCE);
});

it("omits guidance for suppressed workflows (sweep/CEO singleton)", () => {
  const prompt = buildSubagentSystemPrompt({
    basePrompt: "x",
    skillContent: "",
    workflowId: "memory_learning_sweep",
  } as never);
  expect(prompt).not.toContain(MEMORY_CAPTURE_GUIDANCE);
});
```

- [ ] **Step 2: Run it — expect FAIL.** `npm run test:api -- subagent-orchestrator.container-config.operations.spec`

- [ ] **Step 3: Implement** — in `buildSubagentSystemPrompt()`, append the directive layer (matching how the step path composes it), guarded by `shouldSuppressMemoryCapture(workflowId)`. Thread `workflowId` into the function params if it is not already available (it is used elsewhere in subagent provisioning).

- [ ] **Step 4: Run — expect PASS. Lint + commit.**

```bash
npm run test:api -- subagent-orchestrator.container-config.operations.spec && npm run lint:api
git add apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.spec.ts
git commit -m "fix(memory): inject memory-capture guidance into subagent system prompt (EPIC-212 Pillar A)"
```

### Task C3 (conditional — only if C1 shows step agents are also silent with the tool present)

**Why:** If C1 proves the tool materializes and the directive reaches _step_ agents too, yet they still never call `remember`, the directive is not compelling enough. Strengthen it.

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-support-memory-capture.helpers.ts`
- Test: existing `step-agent-system-prompt.helpers.spec.ts`

- [ ] **Step 1:** Tighten `MEMORY_CAPTURE_GUIDANCE` to an explicit end-of-task checkpoint ("Before calling step_complete, if you discovered a durable gotcha/fact/user-request, call `remember` once."), keeping the two canonical examples and the do-NOT list. Update the snapshot/assertion test. TDD as above. Commit.

---

## Final: Redeploy, verify, acceptance

- [ ] **Step 1: Rebuild + redeploy nexus-api** with the B/C code changes:

```bash
npm run build --workspace=packages/core && npm run build:api
docker compose up -d --build api
```

- [ ] **Step 2: Confirm clean boot** (`docker logs nexus-api --since 5m | grep -iE "error|circular|could not"` shows no DI/boot errors; schedulers register).

- [ ] **Step 3: Run the Task 0 purge** now that B1/B2 stop the noise from immediately repopulating.

- [ ] **Step 4: Acceptance checks (the headline complaints):**
  - Learning tab for project `458935f0` no longer shows templated "orchestration cycle" / "Recurring … failures" rows (Task 0 + B1/B2/B3).
  - `event_ledger` shows `remember` tool executions on a fresh run, and `learning_candidates` gains `agent_capture` rows (C2).
  - `retrospective_queue` drains and a real analyst-derived lesson/skill-proposal appears (A2).
  - `memory_embeddings` is non-zero and `learning_candidates` near-dups cluster (`recurrence_count > 1`) on semantic similarity (A1).

- [ ] **Step 5: Update memory + docs.** Update `docs/guide/35-memory-learning.md` "operator enablement" section with the A1/A2 switches and the new B1 gate. Update the memory file `project_epic212_deployed_but_inert.md` with resolved/remaining status.

---

## Self-Review

- **Spec coverage:** Track A (A1 embeddings, A2 retrospective) ✓; Track B (B1 kanban gate, B2 classifier, B3 postmortem) ✓; Track C (C1 verify, C2 subagent directive, C3 conditional) ✓; project cleanup (Task 0) ✓.
- **Open decision for the user:** B3 deletes postmortems outright vs. relabeling them as non-injected evidence — flagged inline, defaulted to disable.
- **Sequencing:** B1/B2/C2 are code (need a redeploy) → land first; A1/A2/B3 are runtime config (no redeploy) → can be flipped immediately but the Task 0 purge should run _after_ B1/B2 deploy so noise does not repopulate.
- **Type/name consistency:** `KANBAN_ORCHESTRATION_CYCLE_TEMPLATE` / `ORCHESTRATION_CYCLE_TEMPLATE` regex shared between B1 setting-constants and B2 classifier (single source — import one from the other during implementation); `classifyTemplateNoise` returns `{isTemplate, isLowSignal}` consistently; `MEMORY_CAPTURE_GUIDANCE` / `shouldSuppressMemoryCapture` reused from the step helper in C2.
