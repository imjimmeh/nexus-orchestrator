# EPIC-202: Close the AI Self-Improvement Loop — Inject, Apply, Govern

**Status:** Proposed (Loop 3 partially closed by EPIC-205)
**Priority:** P1
**Created:** 2026-06-08
**Updated:** 2026-06-09
**Owner:** Memory / Learning Platform
**Beads:** kanban-seo
**Parent:** None
**Depends on:** None
**Related:** EPIC-067 (Memory-Driven Learning and Automated Retrospectives), EPIC-084 (Autonomous Memory Dreaming and Skill Self-Improvement), EPIC-117 (Retrospective Checkpoints and Continuous Learning Cadence), EPIC-141 (Transcript-Derived Skill Discovery), EPIC-142 (Skill Proposal Quality and Governance), EPIC-175 (Core API Self-Improvement Roadmap), EPIC-176 (Self-Improvement Reality Alignment and Learning API Restoration), EPIC-177 (Governed Learning Writeback and Runtime Memory Tooling), EPIC-179 (Runtime Feedback to Learning Candidates), EPIC-201 (Agent Skill Search Enhancement)

## Summary

The Nexus self-improvement stack captures learning from multiple sources (runtime failures, project retrospectives, agent transcripts, explicit `record_learning` calls) but discards that learning at the last step on every path. Three terminal dead-ends — all of which appear built from a surface read — mean the AI never actually improves from what it learns.

This epic closes all three loops, adds meaningful governance to promotion, and removes the doc/code divergence that has twice caused a false sense of completeness (EPIC-175, EPIC-176).

## Implementation Progress

| Loop / Area | Status | Notes |
|-------------|--------|-------|
| Loop 1: Lesson injection into agent context | ❌ Open | `query_memory` still drops provenance; no auto-inject on planning steps |
| Loop 2: `memory_context` wired into prompt | ❌ Open | Assembler still runs but context is not consumed downstream |
| Loop 3: Approved skill proposals applied | ✅ Partially closed (EPIC-205) | `approve()` now emits `SKILL_PROPOSAL_APPROVED_EVENT`; `SkillProposalApprovedListener` dispatches a `create_skill` workflow; `SkillProposalCompletionListener` writes `applied`/`failed` status. The patch is applied by the workflow agent, not inline in `approve()`. |
| Governance: confidence threshold | ❌ Open | `DEFAULT_MINIMUM_CONFIDENCE` still 0 |
| Governance: human gate on workflow promotion | ❌ Open | No capability check in `MemoryToolsHandler.promoteCandidate` |
| Fix `getStatus()` | ❌ Open | Returns hardcoded zeros |
| Wire `failure_threshold` trigger | ❌ Open | Defined in `retrospective.types.ts` but never constructed |
| Delete dead code | ⚠️ Partial | Duplicate search tool removed; DB skill layer still registered |

Beads issue: **kanban-seo** (open, not claimed).

---

## Problem Statement

### The three broken loops

#### 1. Promoted lessons are never injected into agent context
EPIC-067's central promise — auto-injecting relevant promoted lessons into agent planning — is unbuilt. Promoted `fact` segments live in `memory_segments` and are only accessible if an agent explicitly calls `query_memory` with the right keywords. That tool itself does a `content LIKE '%q%'` scan and **drops** stored provenance and confidence from results (`memory-tools.handler.ts:53`). Write-mostly memory with no pull-through into planning.

#### 2. `memory_context` is assembled every turn and then thrown away
`ChatMemoryContextAssemblerService.assembleContext` runs on every chat turn: retrieves, scores, `touchAccessed`, records metrics. The assembled context is packed into `chat-to-core-action.service.ts:318`. There are **zero downstream readers** of `memory_context` in `workflow/` or `pi-runner`. The retrieved chat memory never reaches the agent prompt. The retrieval/scoring/metrics infrastructure is live dead weight.

#### 3. Approved skill proposals are never applied
`SkillProposalService.approve()` (`skill-proposal.service.ts:57`) flips a status field and emits an audit event. It does not call `SkillValidationService`, does not call `writeSkillMarkdown`, and never sets `applied_at`. The `getPreview()` method returns `current_markdown: null` — no diff is possible because the current skill content is never loaded. The entire EPIC-084 self-improvement loop terminates at a governance record with no effect on any skill file.

### Governance is effectively a no-op

- `DEFAULT_MINIMUM_CONFIDENCE = 0` (`learning-promotion-policy.service.ts:10`) — any candidate with non-blank text can be promoted. The deterministic policy gate is a rubber stamp.
- The workflow sweep promotes with `requestedBy: 'workflow_sweep'` and **no role/capability check at the handler**. An agent in any workflow that is granted `promote_learning_candidate` can promote to durable memory without human approval, contradicting EPIC-177's stated intent.
- `SkillValidationService` exists and is well-tested but is never invoked on proposal `patch_markdown`. Free-text patches bypass all validation.

### Doc/reality drift (the EPIC-176 trap, recurring)

- **EPIC-084 marked "Implemented"** documents a `memory-learning` BullMQ queue and `MEMORY_LEARNING_*` env knobs that do not exist in the codebase. The actual implementation is the generic `scheduled-jobs` queue + seeded cron row + LLM sweep workflow.
- **EPIC-142 marked "Implemented"** but ~80% of its own implementation notes (`ProposalDiagnostics`, `resolveTargetSkillMatch`, real preview diff, `validatePreview`, creation/validation-failed events) are absent. `findRelatedByTargetSkill` in the repository is dead code.
- **EPIC-117 (checkpoint cadence) still Proposed.** The `failure_threshold` retrospective trigger is defined (`retrospective.types.ts:20`) but never constructed or called anywhere. Retrospectives only fire at project completion, which was the original sparseness complaint EPIC-117 was created to fix.

### Additional dead code (hygiene)

- Orphaned DB skill layer: `AgentSkill`/`AgentProfileSkill` entities + `AgentSkillRepository` are registered in `database.module.ts` but never injected anywhere — superseded by the filesystem migration (see `docs/plans/2026-04-06-agent-skills-filesystem-storage-plan.md`).
- Duplicate `search_skills` tool: `tools/discovery/search-skills.tool.ts` and `tools/skill/search-skills.tool.ts` share a name and route; only the `tools/skill/` variant is registered. The other is dead.
- `LearningService.getStatus()` returns hardcoded zeros for `intervalSeconds`, `promotionThreshold`, `proposalThreshold`, and `lastRun: null`.
- Unpopulated entity scoring columns: `stage_diversity_count`, `failure_reduction_relevance`, `recency_decay`, `source_quality_confidence` are declared on `learning-candidate.entity.ts` but never populated by any code path.
- The `reject` path writes a raw `updateById` with no repository method, no event emission, and no role gate. `archived` status is defined in `@nexus/core` but never written.
- Chat memory tables are created via `CREATE TABLE IF NOT EXISTS` at boot with swallowed errors (`chat-memory-schema-bootstrap.service.ts:14-19`) — not migrations; silently non-functional on misconfigured deployments.

## Goals

- Promoted lessons influence the content of an agent prompt on subsequent runs.
- An approved skill proposal results in a changed skill file on disk.
- `query_memory` returns provenance (confidence, source, promotion policy) alongside content.
- A real, non-zero confidence threshold gates memory promotion.
- Human approval is enforced on the workflow tool path for memory promotion, not just skill proposals.
- `LearningService.getStatus()` returns real schedule + last-run data.
- All orphaned DB entities, dead tools, and unregistered code paths are removed.
- No EPIC marked "Implemented" where its own implementation notes are materially false.

## Non-Goals

- Do not replace the LLM-driven sweep with a fully deterministic promotion engine — the agent-reviewed sweep is intentional; this epic adds guardrails around it, not a replacement.
- Do not implement embedding-based `query_memory` retrieval (see EPIC-201).
- Do not build the full EPIC-117 checkpoint cadence — only wire the `failure_threshold` trigger as the highest-value unbuilt milestone.
- Do not change the `learning_candidates` table schema or external API contracts.

## Current-State Baseline

| Component | Location | Gap |
|-----------|----------|-----|
| Memory promotion | `learning-promotion.service.ts` | No context injection; provenance dropped from tool results |
| `query_memory` tool | `memory-tools.handler.ts:53` | Projects only `id/content/type/timestamps`; drops `metadata_json` |
| `memory_context` assembly | `chat-to-core-action.service.ts:318` | Assembled but never consumed downstream |
| Skill proposal approve | `skill-proposal.service.ts:57` | Status flip only; no patch application |
| Skill proposal preview | `skill-proposal.service.ts:40` | Returns `current_markdown: null` |
| Confidence gate | `learning-promotion-policy.service.ts:10` | `DEFAULT_MINIMUM_CONFIDENCE = 0` |
| Workflow promote tool | `memory-tools.handler.ts:110` | No capability/role check |
| `getStatus()` | `learning.service.ts:62` | Returns hardcoded zeros + null lastRun |
| `failure_threshold` trigger | `retrospective.types.ts:20` | Defined; no producer anywhere |
| `reject` path | `memory-tools.handler.ts:120` | Raw `updateById`; no event, no gate, no repository method |
| `AgentSkillRepository` | `database.module.ts:261` | Registered; never injected; dead |
| `tools/discovery/search-skills.tool.ts` | workflow-internal-tools | Dead duplicate of registered tool |
| `learning.candidate.proposed.v1` listener | `learning-candidate-proposal.listener.ts` | **Real** — Kanban emits this event; end-to-end wired |
| Runtime feedback ingestion | `runtime-feedback-ingestion.service.ts` | Real; 4 producers wired |
| Nightly sweep | `scheduled-jobs` + `memory_learning_sweep.workflow.yaml` | Real; `0 2 * * *` cron seeded |

## Architecture

### P0 — Close the three loops

#### Loop 1: Lesson injection into agent context

The `query_memory` tool is the agent's only read path to promoted memory. Two changes make it useful:

1. **Surface provenance.** `MemoryToolsHandler.queryMemory` currently projects `{ id, content, memory_type, version, created_at, updated_at }` from `metadata_json`, dropping confidence, source, and promotion policy. Extend the projection to include `{ confidence, source, promoted_by, promotion_policy }` from the stored metadata.

2. **Auto-inject on planning steps.** Add a `project_brief_enricher` that, before emitting `get_project_brief` or any planning-phase output, calls `queryMemory` with the current project/scope, selects the top-N lessons above a minimum confidence threshold, and appends them as a `## Prior lessons` section. Implement as a capability/middleware hook, not hardcoded in the brief builder.

#### Loop 2: Wire `memory_context` into the prompt or remove it

**Option A (implement):** Pass the assembled `memory_context` slices into the `pi-runner` prompt builder. The runner already receives `memory_context` in the workflow input — extend the prompt-building step to append high-score slices as a `## Memory` section within the system prompt. Replace the `chars/4` token approximation with `TokenCounterService` for accurate budget enforcement.

**Option B (remove):** If the chat-memory pipeline is superseded by the entity-memory path, delete the assembler call at `chat-messages.service.ts:121`, `buildMemoryContextSafe`, and `chat-to-core-action.service.ts:307-318` along with the dead metrics/`touchAccessed` call chain. The decision between A and B must be made before implementation begins.

_This epic records the decision in a new ADR._

#### Loop 3: Apply approved skill proposals

```
approve()
  → load current skill markdown from AgentSkillLibraryService
  → apply patch_markdown as a unified diff (or full replace if no diff markers)
  → validate via SkillValidationService.validateSkill()
     └─ on failure: set status = 'apply_failed', error_message, emit skillProposalApprovalFailed
  → writeSkillMarkdown(targetSkillName, resultingMarkdown)
  → set applied_at = now()
  → emit skillProposalApproved with applied_at
```

`getPreview()` must load the current skill markdown first — `current_markdown: null` is the blocker for human reviewers.

### P1 — Governance

**Confidence threshold:** Set `DEFAULT_MINIMUM_CONFIDENCE = 0.5` in `learning-promotion-policy.service.ts`. Expose as a configurable system setting (`MIN_PROMOTION_CONFIDENCE`). Thread it through all callers — currently neither the API path nor the workflow tool path passes a value.

**Human gate on workflow promotion:** Add a `requiresHumanApproval` capability check in `MemoryToolsHandler.promoteCandidate`. When the calling context is `'workflow_sweep'`, the tool should only promote if the candidate has a `human_approved_at` timestamp (set via a separate API call) or if the workflow was launched with explicit operator scope. Otherwise, the tool should create a **pending approval request** instead of promoting directly.

**Proposal validation:** Invoke `SkillValidationService.validateSkill(parsed(patch_markdown))` inside `SkillProposalService.approve()` before any write. Surface `skill_proposal_validation_failed` event on failure (constant already defined in `autonomy-observability.types.ts`).

### P2 — Hygiene

**Reconcile EPIC-084/142:** Update both epics' Status from "Implemented" to "Partially Implemented" and add a "Reality gap" section listing what the notes claim vs. what exists. Follow with a second pass updating to "Implemented" once this epic's work lands.

**Fix `getStatus()`:** Replace hardcoded zeros with real data from `ScheduledJobsService` (next run, last run) and `LearningCandidateRepository` counts. The `sweepRunning` flag should check for an active workflow run of `memory_learning_sweep`.

**Wire `failure_threshold` trigger:** In `KanbanRetrospectiveService`, add a `checkFailureThreshold(projectId)` method called by `OrchestrationCycleDecisionService` when consecutive failure events exceed a configurable count. Produces a `retrospective_run` with `trigger = 'failure_threshold'`.

**Delete dead code:**
- Remove `AgentSkill`, `AgentProfileSkill` entities, `AgentSkillRepository`, and their module registrations.
- Remove `apps/api/src/workflow/workflow-internal-tools/tools/discovery/search-skills.tool.ts`.
- Remove the four unpopulated scoring columns from `learning_candidate` (add a migration to drop them) unless a concrete scoring implementation is planned in a named epic.
- Add `reject()` and `archive()` methods to `LearningCandidateRepository`; emit `learningRejected` event; add role gate in `MemoryToolsHandler`.
- Convert `chat-memory-schema-bootstrap.service.ts` table creation to proper TypeORM migrations.

### P3 — Quality (deferred to follow-on epics)

The following are out of scope for this epic but should be filed as follow-on:

- Semantic/fuzzy `query_memory` retrieval (overlaps EPIC-201).
- Confidence decay and expiry of memory segments.
- True semantic dedup of learning candidates.
- Honcho write path (currently Postgres-only even in `honcho` mode).

## Workstreams

### W1: Preview and apply skill proposals
Fix `getPreview` to load current skill markdown → implement patch application in `approve()` → add `SkillValidationService` gate → set `applied_at` → emit correct events.

*Acceptance:* Approving a proposal with valid `patch_markdown` modifies the target skill file. `getPreview` returns non-null `current_markdown` and a `resulting_markdown` showing the merge. Approving an invalid patch sets `apply_failed` status and emits `skillProposalApprovalFailed`. All existing `skill-proposal.service.spec.ts` tests continue to pass.

### W2: Surface provenance in `query_memory` and add lesson injection
Extend `queryMemory` projection to include confidence/source/provenance. Add `project_brief_enricher` capability hook. Write integration test asserting a promoted lesson appears in a subsequent agent planning input.

*Acceptance:* `query_memory` response includes `confidence` and `source` fields. A promoted lesson above `MIN_PROMOTION_CONFIDENCE` appears in the project brief context on the turn after promotion.

### W3: Wire `memory_context` into prompt or remove it (decision required)
ADR decision → implement whichever path is chosen → delete the other path entirely.

*Acceptance:* Either (A) a chat turn with matching profile memory includes that memory in the system prompt, verified by integration test, or (B) the assembler call and all downstream dead code is deleted and no tests reference the removed code.

### W4: Real confidence threshold and human approval gate
Set `DEFAULT_MINIMUM_CONFIDENCE = 0.5`. Add human-approval gate to `MemoryToolsHandler.promoteCandidate` for workflow contexts. Thread threshold through API and tool paths.

*Acceptance:* A candidate with `confidence < 0.5` is rejected by `LearningPromotionPolicyService`. A workflow sweep call to `promote_learning_candidate` on an unapproved candidate creates a pending approval request rather than promoting.

### W5: Fix `getStatus()`, delete dead code, wire `failure_threshold`
`LearningService.getStatus()` returns real data. Dead entities/tools/columns removed with migrations. `failure_threshold` trigger wired in Kanban orchestration. `reject()`/`archive()` hardened with events and role gates. Chat-memory schema migrated.

*Acceptance:* `GET /memory/learning/status` returns a non-null `lastRun` and correct `intervalSeconds` after the scheduler runs. All referenced dead files/entities are gone. A Kanban project with N consecutive failures triggers a retrospective with `trigger = 'failure_threshold'`.

## Implementation Order

```
W1 (proposal apply — isolated, high value)
  → W3 (ADR decision then implement — clarifies memory_context fate before W2)
  → W2 (lesson injection — depends on W3 ADR, independent of W4)
  → W4 (governance — independent of W1-W3)
  → W5 (hygiene — independent, can run in parallel with W2/W4)
```

W1 and W5 are independently shippable at any point. W3's ADR should be decided before W2 begins.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Patch application breaks skill files | Medium | Validate with `SkillValidationService` before write; keep a backup copy before overwrite; set `apply_failed` on error |
| Reseed overwrites applied patches | High | Seeder does a destructive `rmSync` — must exclude skills with `applied_at` history or flag them as "managed". See EPIC-101 (Planned). |
| Raising confidence threshold rejects historically promoted candidates | Low | Threshold applies only to new promotions; existing `promoted` segments are unaffected |
| `memory_context` removal breaks a downstream consumer we missed | Low | Grep confirms zero non-spec consumers; add a compile-time check before removal |
| Human-approval gate blocks nightly sweep entirely | Medium | Gate only when sweep is running unattended; admin-dispatched sweeps bypass with explicit operator scope |

## Related Artifacts

- Investigation findings: conversation 2026-06-08 (Opus 4.8 multi-agent review)
- `apps/api/src/memory/learning/skill-proposal.service.ts` (no-op approve, null preview)
- `apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts:53` (provenance dropped), `:110` (no capability gate)
- `apps/api/src/memory/learning/learning-promotion-policy.service.ts:10` (zero threshold)
- `apps/api/src/memory/learning/learning.service.ts:62` (hardcoded status zeros)
- `apps/api/src/chat/chat-actions/chat-to-core-action.service.ts:307-318` (dead memory_context handoff)
- `apps/api/src/ai-config/database/repositories/agent-skill.repository.ts` (orphaned)
- `apps/api/src/workflow/workflow-internal-tools/tools/discovery/search-skills.tool.ts` (dead duplicate)
- `apps/api/src/chat/memory/chat-memory-schema-bootstrap.service.ts` (schema via boot)
- `apps/kanban/src/retrospectives/retrospective.types.ts:20` (unused `failure_threshold`)
- `seed/workflows/memory-learning-sweep.workflow.yaml` (real nightly sweep)
