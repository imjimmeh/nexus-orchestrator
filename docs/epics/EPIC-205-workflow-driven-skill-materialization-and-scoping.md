# EPIC-205: Workflow-Driven Skill Materialization & Multi-Scope Binding

**Epic ID:** EPIC-205
**Status:** Complete
**Priority:** P1
**Type:** Feature
**Theme:** Self-Improvement Loop Closure & Skill Governance
**Created:** 2026-06-08
**Updated:** 2026-06-09
**Owner:** Memory / Learning Platform
**Depends On:** None (W1–W3 are self-contained)
**Soft Depends On:** EPIC-204 (scope hierarchy / `scope_node` backbone — this epic's frontmatter scoping is the pragmatic precursor that should converge onto 204's tree)
**Related:** EPIC-202 (Close the AI Self-Improvement Loop — "Loop 3: Apply approved skill proposals"), EPIC-084 (Autonomous Memory Dreaming and Skill Self-Improvement), EPIC-141 (Transcript-Derived Skill Discovery), EPIC-142 (Skill Proposal Quality and Governance), EPIC-203 (Conversational Project Onboarding — the artifact-authoring-workflow template)

## Implementation Summary

All four workstreams have shipped. The full materialization loop is now operational:

- **W1 — Skill scoping infrastructure:** Added `SkillScopeSchema` to `@nexus/core`; extended frontmatter parsing in `AgentSkillLibraryService` to read the `scope` block; added `listSkillsForScope`; extended `resolveAssignedSkills` with the scope union; threaded `workflowId` into both executor call sites.

- **W2 — `create_skill` tool, persona, and workflow:** New `create-skill.tool.ts` internal tool (create-or-update, writes provenance + scope); new `skill-author` agent persona with the tool granted; `seed/workflows/create-skill.workflow.yaml` + `prompts/create-skill/author.md` instructing the agent to author, recommend scope, and emit structured job output.

- **W3 — Approval dispatch + completion bookkeeping:** `SkillProposalService.approve()` now emits `SKILL_PROPOSAL_APPROVED_EVENT` on `EventEmitter2`; `SkillProposalApprovedListener` dispatches `create_skill`; `SkillProposalCompletionListener` detects skill-proposal runs via `stateVariables.trigger.source_proposal_id` and writes `status='applied'` + `applied_at` + `scope_confirmation` diagnostics on success, or `status='failed'` + `error_message` on failure. `'applied'` and `'failed'` statuses added to `@nexus/core`.

- **W4 — Human scope confirmation + UI:** `POST /skills/proposals/:id/confirm-scope` accepts `{ scope }`, requires `applied` status, writes confirmed scope into SKILL.md frontmatter via `js-yaml`. Frontend: `ScopeConfirmationCard` rendered for `applied` proposals with Confirm / Set Global / Override actions; `SkillEditor` gains scope fields; `useConfirmSkillImprovementProposalScope` hook.

---

## Summary
Approving a **Skill Improvement Proposal** (project workspace → Learning tab) is currently a dead end. `SkillProposalService.approve()` flips `status: pending → approved`, writes an observability-ledger row, and does nothing else. No `SKILL.md` is created or updated; the entity's `applied_at` / `error_message` columns are never written. The UI confirms the no-op: `formatProposalNextStep` returns *"Approval decision recorded. No patch was applied."* This terminates the entire EPIC-084/EPIC-141/EPIC-142 self-improvement chain at a governance record with no effect on any skill.

This epic closes that loop with a **workflow-driven materialization pipeline**: approving a proposal dispatches a `create_skill` workflow where an authoring agent reviews context, produces or refines the `SKILL.md` (create-or-update), and **recommends a scope**. The skill is materialized to the filesystem library, and the human **confirms or overrides** the recommended scope. To make scope meaningful, the epic also adds the **first scoping infrastructure** to the skill subsystem — skills can be **global**, **project-bound**, **agent-bound**, **workflow-bound**, or any combination — with the runtime resolver assembling the correct skill set per agent step.

> This is the ambitious realization of EPIC-202's "Loop 3". Where EPIC-202 scoped a deterministic in-process patch-apply, EPIC-205 makes materialization **agent-authored and workflow-governed**, and adds the **scoping dimension** EPIC-202 did not address. If both are scheduled, EPIC-205 W1 supersedes EPIC-202 W1.

## Problem Statement

### The approve path is a terminal no-op

`apps/api/src/memory/learning/skill-proposal.service.ts:57` (`approve()`):
- Calls `proposals.updatePendingById(id, { status: 'approved', approved_by, approved_at })`.
- Emits `memory.learning.skill_proposal_approved` **to the observability ledger** (`EventLedgerService.emitBestEffort`) — a write-and-store sink with **no subscribers that perform work**. It is read back only by display projections.
- Never loads or writes skill markdown; never sets `applied_at`. `getPreview()` returns `current_markdown: null`.

The only consumers of the emitted event are autonomy **diagnostics projections** (`workflow-run-learning-autonomy-diagnostics.projection.ts`), which render a status badge. No skill changes.

### Skills have no scoping at all

- Skills are **filesystem-backed**: `storage/skills/<name>/SKILL.md` with YAML frontmatter, resolved by `AgentSkillLibraryService`, CRUD via `AgentSkillsService.createSkill/updateSkill` → `writeSkillMarkdown`. The DB `agent_skills` / `agent_profile_skills` entities are **dead/unused at runtime** (also flagged for deletion in EPIC-202).
- The **only** binding mechanism is `AgentProfile.assigned_skills` — a `simple-array` of skill **names** (`apps/api/src/ai-config/database/entities/agent-profile.entity.ts:51`). There is no `projectId`, `agentId`, `workflowId`, or scope/visibility anywhere on a skill. Every skill is globally available; the only "scoping" is whether a profile lists it by name.
- Consequence: a materialized skill cannot be confined to the project, agent, or workflow it was learned in. It is all-or-nothing global.

### "Emit → do work" must use the right bus

Two distinct mechanisms exist and are routinely confused:
- `EventLedgerService.emitBestEffort()` → append-only Postgres `event_ledger`; **drives no work**.
- NestJS `EventEmitter2` + `@OnEvent` → real pub/sub that triggers handlers (canonical: `DoctorRepairDelegationListener`, `apps/api/src/operations/doctor-repair-delegation.listener.ts`; in-module example: `LearningCandidateProposalListener`).

The approve path emits only to the ledger, so wiring dispatch requires the `EventEmitter2` path (or a direct `startWorkflow` call).

## Goals

- Approving a skill proposal results in a materialized `SKILL.md` on disk (created if new, updated if existing) and sets `applied_at`.
- Materialization is **agent-authored via a `create_skill` workflow**, with a deterministic fast-path for trivial/complete patches.
- A skill can be bound to any combination of **global / project / agent / workflow**, and the runtime resolver mounts the correct set for each agent step.
- The authoring agent **recommends** a scope with rationale; a human **confirms or overrides** it before the binding is final.
- Existing skills (no scope frontmatter) continue to resolve exactly as today (global) — zero regression.
- Materialized skills carry **provenance** (originating proposal id, generating run id).

## Non-Goals

- Do **not** revive the dead DB skill entities; the filesystem remains the single source of truth for skill content and scope.
- Do **not** build EPIC-204's full `scope_node` hierarchy / RBAC inheritance. This epic uses pragmatic frontmatter scope arrays keyed on existing `scopeId` / profile-name / `workflow_id`, designed to **converge** onto 204 later.
- Do **not** change the learning-sweep proposal-generation path or the `learning_candidates` schema.
- Do **not** implement scope-aware skill **search indexing** (the text index stays text-only); scope filtering is an in-memory scan over the library for now.

## Current-State Baseline

| Component | Location | Gap |
|-----------|----------|-----|
| Skill proposal approve | `memory/learning/skill-proposal.service.ts:57` | Status flip + ledger emit only; no materialization, no `applied_at` |
| Skill proposal preview | `memory/learning/skill-proposal.service.ts:40` | `current_markdown: null` |
| Skill content store | `ai-config/services/agent-skill-library.service.ts` | FS-backed; `source` hardcoded `'imported'`; **no scope field** |
| Skill CRUD | `ai-config/services/agent-skills.service.ts:70` | `createSkill`/`updateSkill` → `writeSkillMarkdown`; the correct persistence path |
| Skill binding | `ai-config/database/entities/agent-profile.entity.ts:51` | `assigned_skills` names only; no project/agent/workflow scope |
| Runtime resolver | `workflow/workflow-stage-skill-policy.service.ts:50` | Resolves `assigned_skills` + stage-policy filter; **no scope union** |
| Resolver context | `workflow/workflow-step-execution/step-support.service.ts:227` | Has `scopeId`; **`workflowId` not threaded** |
| Workflow dispatch | `workflow/workflow-engine.service.ts:67` | `startWorkflow(workflowId, triggerData)`; call-site template `learning.service.ts:83` |
| Artifact-authoring template | `seed/workflows/project-charter-ceo.workflow.yaml` + `update-charter.tool.ts` | Agent authors + persists via internal tool — the model to copy |
| Proposal tool (analog) | `workflow-internal-tools/tools/memory/create-skill-proposal.tool.ts` | Template for a new `create_skill` tool; **no `create_skill` tool exists** |
| Event bus reality | `observability/event-ledger.service.ts` vs `app.module.ts:57` (`EventEmitter2`) | Approve emits to ledger only — no work driven |
| Proposal statuses | `packages/core/src/schemas/memory/learning-contracts.schema.ts:10` | `pending|approved|rejected|failed`; no `applied` |
| UI next-step | `apps/web/.../LearningTab.helpers.ts:184` | Hardcodes "No patch was applied." |

## Architecture

### Materialization loop (end to end)

```
human approves proposal
  → SkillProposalService.approve(): status=approved + ledger emit (existing)
                                  + EventEmitter2.emit(SKILL_PROPOSAL_APPROVED_EVENT, payload)   [NEW]
  → SkillProposalApprovedListener @OnEvent → WorkflowEngineService.startWorkflow('create_skill', {
        proposalId, targetSkillName, patchMarkdown, proposalSummary, scopeId })                  [NEW]
  → create_skill workflow, agent_profile: skill-author
        agent loads proposal context (patch_markdown is the FULL resulting SKILL.md)
        fast-path: trivial/complete patch → persist as-is
        else: refine SKILL.md, decide create-vs-update, recommend scope + rationale
        agent calls create_skill tool → AgentSkillsService.createSkill|updateSkill (writeSkillMarkdown)
        set_job_output { skill_name, materialized, recommended_scope, scope_rationale } → step_complete
  → WorkflowRunCompleted @OnEvent (filter workflowId==create_skill)                               [NEW]
        success: proposal.status='applied', applied_at=now,
                 diagnostics_json.scope_confirmation={ pending:true, recommended_scope, rationale }
        failure: status='failed', error_message; emit skillProposalApprovalFailed
  → human confirms/overrides scope (Learning tab card)
        POST skills/proposals/:id/confirm-scope → writes final `scope` into SKILL.md frontmatter
```

### Scope model (filesystem-authoritative)

Scope is a first-class `scope` object in `SKILL.md` frontmatter; arrays give many-to-many; absent/empty ⇒ **global** (backward compatible).

```yaml
scope:
  projects:  [<scopeId>, ...]       # neutral scopeId values per AGENTS.md naming rule (NOT kanban ids)
  agents:    [<agent-profile-name>, ...]
  workflows: [<workflow_id>, ...]
```

Resolver union (`resolveAssignedSkills`): assembled base set =
`assigned-global (listSkillsByProfileName, filtered to !scope) ∪ listSkillsForScope({ scopeId, agentProfile, workflowId })`, deduped by name; the existing stage-policy include/exclude filter applies on top. Scope is a **guard**, assignment is a **grant within scope**.

**Threading gap:** `scopeId` is derivable from `stateVariables.trigger` (reuse `getScopeId`). `workflowId` is **not** currently threaded into the resolver — must be passed from `WorkflowRun.workflow_id` at the two executor call sites (`step-agent-step-executor.service.ts`, `step-agent-container-support.service.ts`).

### Provenance

Materialized skills record `metadata.source_proposal_id` and `metadata.generated_from_run_id` in frontmatter, enabling reseed-safety (a skill with materialization provenance must not be clobbered by the destructive seeder — see Risks) and audit back to the originating learning candidate.

## Workstreams

### ✅ W1: Skill scoping infrastructure (foundation)
Add `SkillScopeSchema` to `@nexus/core` skills contracts; add `scope` to `SkillLibraryRecord` and frontmatter parsing in `buildSkillRecord`; add `AgentSkillLibraryService.listSkillsForScope`; extend `resolveAssignedSkills` with the scope union and new `scopeId`/`workflowId` params; thread `workflowId` from the run into both executor call sites.

*Acceptance:* A project-scoped skill mounts only for runs in that `scopeId`; agent-scoped only for that profile; workflow-scoped only for that `workflow_id`; combinations union and dedup; the stage-policy filter still applies; an unscoped skill resolves as global exactly as before. Covered by `workflow-stage-skill-policy.service.spec.ts` + `agent-skill-library.service.spec.ts` + a resolver-plumbing test for `workflowId`.

### ✅ W2: `create_skill` tool, persona, and workflow
New `create-skill.tool.ts` internal tool (create-or-update via `skillExists`, persists scope + provenance) modeled on `create-skill-proposal.tool.ts` / `update-charter.tool.ts`; new `skill-author` persona (`seed/agents/skill-author/`) with the tool granted; new `seed/workflows/create-skill.workflow.yaml` (`workflow_id: create_skill`) + `prompts/create-skill/author.md` instructing the agent to author/refine, recommend scope, persist, and `set_job_output`/`step_complete`.

*Acceptance:* Manually dispatching `create_skill` with a proposal's data writes/updates `storage/skills/<name>/SKILL.md` with provenance and a recommended scope, and emits a structured job output. Tool unit test asserts create-vs-update branching.

### ✅ W3: Approval dispatch + completion bookkeeping
Emit `SKILL_PROPOSAL_APPROVED_EVENT` on `EventEmitter2` from `approve()`; new `skill-proposal.listener.ts` (`@OnEvent`) dispatches the workflow; new completion handler (`@OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)`, filtered) sets `applied_at` + scope-confirmation diagnostics on success or `error_message` + `failed` on failure; add `'applied'` status to `@nexus/core`; wire `WorkflowEngineService`/`EventEmitter2` into `LearningModule` without a circular dep.

*Acceptance:* Approving a pending proposal starts a `create_skill` run (verified by returned runId); on completion the proposal shows `applied` with `applied_at` set and a `scope_confirmation` payload; an authoring failure sets `failed` + `error_message`. Listener test mirrors `doctor-repair-delegation.listener.spec.ts`.

### ✅ W4: Human scope confirmation + UI
New `confirmSkillProposalScopeSchema` + `POST skills/proposals/:id/confirm-scope` → `confirmScope()` writes final `scope` to frontmatter and clears the pending flag. Learning tab renders the `applied` state and a scope confirm/override card (scope kind + project/agent/workflow pickers); update `formatProposalNextStep` and `proposalStatusBadgeVariant`; add the API client method. Skill editor (`SkillEditor.tsx` + `useAgentSkills.ts`) gains scope fields for direct (re)scoping.

*Acceptance:* An applied proposal surfaces the agent's recommended scope + rationale; Confirm keeps it, Override writes the human's scope into the `SKILL.md` frontmatter; the editor can re-scope any skill. Schema + controller tests green.

## Implementation Order

```
W1 (scoping foundation — independent, unblocks meaningful scope in W2-W4)
  → W2 (tool + persona + workflow — depends on W1 scope schema)
  → W3 (dispatch + bookkeeping — depends on W2 workflow existing)
  → W4 (human confirmation + UI — depends on W3 producing scope-confirmation state)
```

W1 is independently shippable (adds scoping even before materialization exists). W2 is testable in isolation by manual dispatch before W3 wires the trigger.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Destructive reseed clobbers a materialized/applied skill | High | Seeder does `rmSync`; exclude skills carrying `metadata.source_proposal_id`/`applied_at` provenance or flag them "managed" (shared concern with EPIC-202 W1) |
| `workflowId` plumbing missed at one call site | Medium | Update both `step-agent-step-executor` and `step-agent-container-support`; add a resolver-plumbing test asserting forwarding |
| Frontmatter scope diverges from EPIC-204 `scope_node` model | Medium | Key on existing neutral `scopeId`/`workflow_id`/profile-name so a later migration maps arrays → tree nodes; document the convergence path |
| Agent authors an invalid SKILL.md | Medium | Validate frontmatter/name in the `create_skill` tool via existing `AgentSkillsService` validation before write; on failure mark proposal `failed` + `error_message` |
| Circular dependency wiring `WorkflowEngineService` into `LearningModule` | Medium | Replicate the existing `LearningService` import path / `forwardRef`; listener-only injection keeps the approve transaction decoupled |
| Scope scan cost as skill count grows | Low | In-memory filter over already-loaded `listSkills()`; defer scope indexing to a follow-on if the library grows large |

## Related Artifacts

- Investigation: conversation 2026-06-08 (Opus 4.8 multi-agent review — skills storage, workflow dispatch, event mechanics, scoping design)
- `apps/api/src/memory/learning/skill-proposal.service.ts` (no-op approve, null preview)
- `apps/api/src/memory/learning/skill-proposals.controller.ts` (`POST skills/proposals/:id/approve`)
- `apps/api/src/ai-config/services/agent-skill-library.service.ts` + `.types.ts` (FS library, frontmatter parse, scope target)
- `apps/api/src/ai-config/services/agent-skills.service.ts:70` (`createSkill`/`updateSkill`)
- `apps/api/src/workflow/workflow-stage-skill-policy.service.ts:50` (resolver union point)
- `apps/api/src/workflow/workflow-step-execution/{step-support,step-agent-step-executor,step-agent-container-support}.service.ts` (scope/workflowId threading)
- `apps/api/src/workflow/workflow-engine.service.ts:67` (`startWorkflow`); `apps/api/src/memory/learning/learning.service.ts:83` (call-site template)
- `seed/workflows/project-charter-ceo.workflow.yaml` + `seed/workflows/prompts/project-charter-ceo/onboard.md` + `apps/api/src/workflow/workflow-internal-tools/tools/charter/update-charter.tool.ts` (artifact-authoring template)
- `apps/api/src/workflow/workflow-internal-tools/tools/memory/create-skill-proposal.tool.ts` (internal-tool template)
- `apps/api/src/operations/doctor-repair-delegation.listener.ts` + `apps/api/src/workflow/workflow-repair/workflow-failure-doctor-completion.listener.ts` (`@OnEvent` work + completion patterns)
- `packages/core/src/schemas/memory/learning-contracts.schema.ts` + `packages/core/src/schemas/ai-config/skills.schema.ts` (contracts to extend)
- `apps/web/src/pages/project-workspace/LearningTab*.{tsx,ts}` + `apps/web/src/lib/api/client.projects.learning.ts` + `apps/web/src/pages/agents/SkillEditor.tsx` (UI surface)
- EPIC-202 (`docs/epics/EPIC-202-close-ai-self-improvement-loop.md`) — overlapping "Loop 3"; reconcile if both scheduled
- EPIC-204 (`docs/epics/EPIC-204-rbac-hierarchy-configurable-platform-gitops.md`) — scope hierarchy this epic should converge onto
