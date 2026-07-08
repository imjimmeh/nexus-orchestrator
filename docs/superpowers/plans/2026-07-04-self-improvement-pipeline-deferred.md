# Self-Improvement Pipeline — Deferred Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deferred pieces from the 2026-07-04 self-improvement follow-ups (FU-10, FU-16, PD-1, PD-3), resolving the product decisions that gated them; explicitly defer PD-2 and FU-23 with rationale.

**Architecture:** Four independent workstreams, each landable on its own: (A) FU-16 config-gated widening of retrospective dedup to agent/workflow scopes; (B) PD-3 a new agent-scope routing rail so agent-scoped `remember` captures are governed at the `agent_preference` 0.8 tier; (C) PD-1 a dead-letter **replay** endpoint in `apps/kanban` that re-emits parked `code_change` events (idempotent by proposalId); (D) PD-4/FU-10 a human-facing "assign skill" flow in the global Improvements queue that creates a governed `skill_assignment` proposal (one new backend create-route + web picker dialog).

**Tech Stack:** NestJS + TypeORM + BullMQ (`apps/api`, `apps/kanban`), Vite + React + Tailwind + TanStack Query (`apps/web`), Zod contracts in `@nexus/core`, Vitest everywhere, Redis Streams (lifecycle stream).

## Decisions Register (ASSUMED — the user was away when asked; confirm before/at spec review)

| #          | Decision                         | Assumed choice                                                                                         | Rationale / where it bites                                                                           |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| PD-4/FU-10 | Skill scope-confirmation UX home | **First-class `skill_assignment` action** in the Improvements queue (page-level "Assign skill" dialog) | Reuses the applier + governance already built; smallest new surface (one create-route + web dialog). |
| PD-1       | Dead-letter replay               | **Build the replay endpoint** in `apps/kanban`                                                         | Today's recovery is a manual `redis-cli XADD`; the table/repo/consumer already live in kanban.       |
| PD-2       | Post-apply probation watcher     | **Defer** (documented below, not built)                                                                | Speculative; needs a regression metric + policy; schema already supports adding it later.            |
| PD-3       | Agent-scoped `remember` tier     | **Align to `agent_preference` 0.8** via a new routing rail                                             | Plain agent captures currently mis-route to the 0.5 project floor.                                   |
| FU-16      | Retrospective dedup blast radius | **Widen to agent/workflow, config-gated, default = current (project+global)**                          | Conservative: no behavior change until an operator opts in.                                          |
| FU-23      | Repo-wide spec-mock typing       | **Backlog ticket, not in this plan** (documented below)                                                | Large mechanical sweep unrelated to this feature; needs its own gate.                                |

> The one decision inside PD-4/FU-10 that most needs confirmation: **how governance should treat a human-initiated `skill_assignment`** (it carries no `struggle_backed`/`inference` evidence class, so the existing confidence caps don't apply cleanly). This plan assumes an explicit **operator-directed provenance** that is exempt from the evidence-class confidence cap and evaluated under the normal `skill_assignment` tier (auto-applies under `tiered`). See Task D1's CONFIRM note.

## Global Constraints

- Strict lint policy: NEVER `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix in code.
- Core/Kanban boundary: `apps/api/src` and `packages/core/src` stay Kanban-neutral (neutral `scopeId`/`scope_id`, `contextId`/`context_id` only); Kanban lifecycle/work-item logic stays in `apps/kanban`. PD-1 is Kanban-only by design.
- TDD: Red → Green → Refactor for every task. Mock external deps (DB, Redis) at the repository/provider boundary.
- Strong typing; named constants (no magic numbers/strings); small single-purpose functions.
- `packages/core` must be rebuilt (`npm run build --workspace=packages/core`) after any change to it before dependent workspaces typecheck.
- Web: components presentation-focused; side-effects in hooks/services (web quality gate). Kanban: `npm run test:kanban`; web: `npm run test:unit:web` (run web suites narrowly — known OOM if two run concurrently).
- Work in the worktree `G:/code/AI/nexus-orchestator/.claude/worktrees/self-improvement-followups` on a dedicated branch; verify `git branch --show-current` before each commit; do not push.

---

## Workstream A — FU-16: config-gated widening of retrospective dedup scope

**Problem.** `RetrospectiveAnalysisService.isAlreadyKnown(scopeId, lesson)` (`apps/api/src/workflow/workflow-retrospective/retrospective-analysis.service.ts:369-406`) calls `this.retrieval.retrieve({ scopeId, queryText, tokenBudget })` and never supplies `agentProfileName`/`workflowName`. `MemoryRetrievalService.fetchCandidateSegments` (`apps/api/src/memory/signals/memory-retrieval.service.ts:247-271`) gates its agent/workflow query branches on those fields, so the dedup pool is always exactly `project(scopeId) + global`. The acting agent-profile name and workflow name ARE resolved in the dispatch half (`resolveActingAgentProfiles`, `resolveOriginalWorkflowYaml`) but are never threaded into `RetrospectiveProcessFindingsInput` (`{ originalRunId, scopeId, rawFindings }`).

**Decision applied:** widen dedup to also consult agent/workflow scopes, **gated behind a new system setting defaulting to OFF** (current behavior preserved unless an operator opts in).

### Task A1: Thread agent/workflow identity into the findings-processing input

**Files:**

- Modify: `apps/api/src/workflow/workflow-retrospective/retrospective-analysis.service.ts` (`RetrospectiveProcessFindingsInput` type; `processFindings`; `isAlreadyKnown` signature + `retrieve` call)
- Modify: the dispatch/enqueue caller that builds `RetrospectiveProcessFindingsInput` (find it: grep `processFindings(` and `rawFindings:` across `workflow-retrospective/`) — pass the already-resolved `actingAgentProfileName` and `originalWorkflowName` through.
- Test: `apps/api/src/workflow/workflow-retrospective/retrospective-analysis.service.spec.ts`

**Interfaces:**

- Produces: `RetrospectiveProcessFindingsInput` gains optional `actingAgentProfileName?: string` and `workflowName?: string`. `isAlreadyKnown(scopeId, lesson, opts?: { agentProfileName?: string; workflowName?: string })`.

- [ ] **Step 1 (Red):** Add a spec asserting that when the new setting is ON and `isAlreadyKnown` is given `agentProfileName`/`workflowName`, `retrieval.retrieve` is called WITH those fields; when the setting is OFF (default), `retrieve` is called WITHOUT them (current behavior). Mock `SystemSettingsService.get` and `MemoryRetrievalService.retrieve`.
- [ ] **Step 2:** Run the spec; verify it fails.
- [ ] **Step 3 (Green):** Add the optional fields to the input type + thread them through `processFindings` into `isAlreadyKnown`. Read the new setting via the existing fail-soft pattern (mirror `resolveSimilarityThreshold` at ~L408): `RETROSPECTIVE_DEDUP_WIDEN_SCOPE_SETTING` default `false` in a `*.constants.ts` beside the service. Only pass `agentProfileName`/`workflowName` into `retrieve` when the setting is truthy.
- [ ] **Step 4:** Run the spec; verify pass. Run the full `retrospective-analysis` spec.
- [ ] **Step 5:** `build:api` + `lint:api` clean. Commit (message references FU-16).

### Task A2: Populate the identity at the call site

**Files:**

- Modify: the caller found in A1 (dispatch half) to pass `actingAgentProfileName` (from `resolveActingAgentProfiles`) and `originalWorkflowName` (from `resolveOriginalWorkflowYaml`) into the input.
- Test: the caller's spec (grep for the dispatch spec covering `processFindings`).

- [ ] **Step 1 (Red):** Spec asserting the input built by the dispatch half now carries the resolved agent-profile name + workflow name.
- [ ] **Step 2:** Verify fail.
- [ ] **Step 3 (Green):** Thread the already-resolved values (do NOT add new DB lookups — reuse what dispatch already resolved).
- [ ] **Step 4:** Verify pass.
- [ ] **Step 5:** `build:api` + `lint:api`. Commit.

> **Note for reviewer:** confirm the agent/workflow query branches in `MemoryRetrievalService.fetchCandidateSegments` already union correctly with project+global (they do per research) — no change needed there. FU-16 is purely supplying the inputs behind a flag.

---

## Workstream B — PD-3: agent-scoped `remember` → `agent_preference` governance tier

**Problem.** `resolveRememberScope` (`apps/api/src/workflow/workflow-internal-tools/handlers/remember.helpers.ts:17-41`) tags an agent capture `scope_type:'agent', scopeId:<profileName>`, but `LearningRouterService.route()` (`apps/api/src/memory/learning/learning-router.service.ts`) has a `routeWorkflowScope` rail (keyed on `scope_type==='workflow'`, L360-374) and **no `routeAgentScope` rail**. `routeAgentPreference` (L376-388) only fires on a behavioural always/never regex + an agentProfile from `signals_json.provenance`. So a plain agent-scoped remember falls through to `routing_target: 'project'`/`'global'`, and `dispatchByRoute` (`learning-promotion.dispatch.ts:24-38`) then governs it at the lenient 0.5 project floor instead of `agent_preference`'s 0.8 (`promotion-governance-policy.service.ts:134-141`).

**Decision applied:** add an explicit `routeAgentScope` rail so any `scope_type==='agent'` capture routes to `agent_preference` (0.8), preserving the agent identity (`scopeId` = profile name).

### Task B1: Add the `routeAgentScope` rail

**Files:**

- Modify: `apps/api/src/memory/learning/learning-router.service.ts` (add `routeAgentScope`, invoke it in `route()` at the same precedence position as `routeWorkflowScope`, before the project/global fallthrough)
- Test: `apps/api/src/memory/learning/learning-router.service.spec.ts`

**Interfaces:**

- Produces: `route()` returns `routing_target: 'agent_preference'` with the agent identity carried for a `scope_type==='agent'` capture that lacks behavioural phrasing.

- [ ] **Step 1 (Red):** Spec: a candidate with `scope_type:'agent'`, `scopeId:'merge-agent'`, and plain (non-always/never) text now routes to `agent_preference` (assert `routing_target`), carrying `merge-agent` as the agent profile — where before it routed to `project`/`global`. Also assert an existing behavioural agent capture still routes via `routeAgentPreference` (no regression), and a `workflow`-scoped capture is unchanged.
- [ ] **Step 2:** Verify fail.
- [ ] **Step 3 (Green):** Implement `routeAgentScope` keyed on `scope_type==='agent'`, mirroring `routeWorkflowScope`'s shape. It sets `routing_target='agent_preference'` and threads the agent profile (from `scopeId`) the same way `routeAgentPreference` populates it, so downstream `resolveSegmentDestination`/dispatch (which already handle `agent_preference`) place it as an agent preference governed at 0.8. Place the call in `route()` immediately after `routeWorkflowScope` and before the project/global fallthrough. Reuse existing constants for the routing-target string.
- [ ] **Step 4:** Verify pass; run full `learning-router.service` spec.
- [ ] **Step 5:** `build:api` + `lint:api`. Commit (references PD-3).

### Task B2: End-to-end governance regression

**Files:**

- Test: `apps/api/src/memory/learning/learning-promotion.service.spec.ts` (has an existing `agent_preference` case ~L570 to mirror) and/or `remember.handler.spec.ts`.

- [ ] **Step 1 (Red):** Spec proving a plain agent-scoped remember is now evaluated against the `agent_preference` 0.8 floor (a 0.6-confidence agent capture that previously would have auto-promoted at the 0.5 project floor is now held for governance / not auto-applied). Assert the governance tier used, not just routing.
- [ ] **Step 2:** Verify fail (against current behavior) → **only if** current behavior actually auto-promotes it; if the pre-existing test already exercises this, extend rather than duplicate.
- [ ] **Step 3 (Green):** Should pass once B1 lands (no new production code expected). If it doesn't, the gap is in dispatch — fix minimally.
- [ ] **Step 4:** Verify pass; run `learning-promotion.service` spec.
- [ ] **Step 5:** `build:api` + `lint:api`. Commit.

> **CONFIRM at review:** aligning ALL agent-scoped remembers to 0.8 raises the bar for auto-applying agent preferences. If the intent was only to align _explicit_ agent captures (not incidental ones), scope the rail to captures whose provenance marks an explicit agent-scope request. Default in this plan: all `scope_type==='agent'`.

---

## Workstream C — PD-1: dead-letter replay for parked `code_change` events (apps/kanban only)

**Problem.** Parked (dead-lettered) lifecycle events sit in `kanban_core_lifecycle_dead_letters`; the existing `POST internal/core/lifecycle-stream/replay` (`CoreEventsController.replayLifecycleStream` → `CoreLifecycleStreamConsumerService.replayFromCursor`, `core-lifecycle-stream.consumer.ts:120-134`) is cursor-forward-only and cannot reach parked rows. Recovery today is a manual `redis-cli XADD`.

**Key facts (from research):**

- Entity `apps/kanban/src/database/entities/kanban-core-lifecycle-dead-letter.entity.ts`: `id, stream_key, stream_id, reason, payload (jsonb), created_at`. No `proposalId` column — it's inside `payload.envelope` (a JSON string). `payload` stores the 4 flat XADD fields verbatim: `event_id, event_type, occurred_at, envelope`.
- Repo `kanban-core-lifecycle-dead-letter.repository.ts`: only `saveDeadLetter`, `countRecent`. No list/find/delete, no spec.
- Handler `core-lifecycle-stream-improvement-task.handler.ts` files a work item idempotently: `findByProjectAndId(projectId, payload.proposalId)` before `createWorkItem(projectId, { id: payload.proposalId, ... })`. So **re-emitting a parked event is safe** — a second file is deduped. The dead-letter write happens in the consumer's generic try/catch (`core-lifecycle-stream.consumer.ts:222-236`).
- Endpoint security: `InternalServiceAuthGuard` + `@InternalServiceScopes('kanban.core-events:write')`, wired in `core-integration.module.ts`.

**Design:** add repo methods to list + delete dead-letter rows; a consumer/service method `replayDeadLetters(opts)` that re-XADDs each stored `payload` back onto `stream:core:lifecycle` and, on success, deletes the replayed dead-letter row (the re-emitted event flows back through the consumer and is filed if the project is now configured, or re-parked if still not — idempotent by proposalId either way); a new controller route.

### Task C1: Dead-letter repo — list + delete (+ optional proposalId filter)

**Files:**

- Modify: `apps/kanban/src/database/entities/repositories/.../kanban-core-lifecycle-dead-letter.repository.ts` (add `listRecent(limit)` / `listAll()` and `deleteById(id)`; an optional helper to extract `proposalId` from a row's `payload.envelope` for filtering)
- Create: `.../kanban-core-lifecycle-dead-letter.repository.spec.ts`

**Interfaces:**

- Produces: `listDeadLetters(opts?: { streamKey?: string; limit?: number }): Promise<KanbanCoreLifecycleDeadLetter[]>`; `deleteDeadLetter(id: string): Promise<void>`.

- [ ] **Step 1 (Red):** Repo spec (in-memory/mocked TypeORM manager per existing kanban repo-spec conventions) asserting `listDeadLetters` returns saved rows and `deleteDeadLetter` removes one.
- [ ] **Step 2:** Verify fail.
- [ ] **Step 3 (Green):** Implement the two methods (+ a pure helper `extractProposalId(payload): string | null` that JSON-parses `payload.envelope` and reads `.proposalId`, fail-soft to null).
- [ ] **Step 4:** Verify pass.
- [ ] **Step 5:** `npm run test:kanban -- kanban-core-lifecycle-dead-letter` green; kanban lint clean. Commit (references PD-1).

### Task C2: `replayDeadLetters` on the consumer service

**Files:**

- Modify: `apps/kanban/src/core/core-lifecycle-stream.consumer.ts` (add `replayDeadLetters`)
- Test: `core-lifecycle-stream.consumer.spec.ts` (extend)

**Interfaces:**

- Consumes: the Redis client used for XADD in this file (reuse the exact same publish mechanism `saveDeadLetter`'s siblings use); `listDeadLetters` / `deleteDeadLetter` (C1).
- Produces: `replayDeadLetters(opts?: { proposalIds?: string[] }): Promise<{ replayed: number; skipped: number }>`.

- [ ] **Step 1 (Red):** Spec: given two parked rows, `replayDeadLetters()` XADDs both stored payloads back onto `stream:core:lifecycle` (assert XADD called with the 4 stored fields verbatim) and deletes both rows; with `{ proposalIds: [oneId] }` only the matching row is replayed+deleted, the other left intact.
- [ ] **Step 2:** Verify fail.
- [ ] **Step 3 (Green):** Implement: `listDeadLetters` → optional filter by `extractProposalId ∈ proposalIds` → for each, XADD `payload` fields to the stream, then `deleteDeadLetter(id)`. Wrap each row in try/catch so one bad row doesn't abort the batch; count replayed/skipped; log a summary. Do NOT touch the forward cursor.
- [ ] **Step 4:** Verify pass; run the consumer spec.
- [ ] **Step 5:** kanban lint clean. Commit.

### Task C3: `POST internal/core/lifecycle-stream/dead-letters/replay` endpoint

**Files:**

- Modify: `apps/kanban/src/core/core-events.controller.ts` (add the route, `@InternalServiceScopes('kanban.core-events:write')`, same guard as siblings)
- Modify: DTO/contract for the optional `{ proposalIds?: string[] }` body (follow the controller's existing DTO pattern)
- Test: `core-events.controller.spec.ts` (extend)

**Interfaces:**

- Consumes: `CoreLifecycleStreamConsumerService.replayDeadLetters` (C2).
- Produces: HTTP `POST internal/core/lifecycle-stream/dead-letters/replay` → `{ replayed, skipped }`.

- [ ] **Step 1 (Red):** Controller spec asserting the route delegates to `replayDeadLetters` with the parsed body and returns its result; guard/scope metadata present.
- [ ] **Step 2:** Verify fail.
- [ ] **Step 3 (Green):** Implement the handler (transport only — no logic in the controller).
- [ ] **Step 4:** Verify pass.
- [ ] **Step 5:** `npm run test:kanban` (touched specs) green; kanban lint + `build:kanban` clean. Commit.

### Task C4: Runbook update

**Files:**

- Modify: `docs/operations/self-improvement-project.md` (replace the "manual `redis-cli XADD` only" recovery note with the new endpoint; keep the manual method as a fallback).

- [ ] **Step 1:** Update the runbook: document the new endpoint, its scope, request/response, and idempotency-by-proposalId. Note that replay re-parks if the project is still unconfigured.
- [ ] **Step 2:** prettier-check clean on the md. Commit (references PD-1).

---

## Workstream D — PD-4 / FU-10: human-facing "Assign skill" → governed `skill_assignment` proposal

**Problem.** Epic A's cutover removed the project-workspace skill scope-confirmation UI; the old `POST /skills/:name/confirm-scope` backend (`SkillProposalService`/`SkillProposalsController`/`ScopeConfirmationCard`) is fully deleted (confirmed by grep). The applier + governance for `skill_assignment` exist, and `ImprovementProposalService.submitProposal` is the generic creation entry point — but the **only producer today is an agent tool** (`suggest-skill-assignment.tool.ts`, an `api_callback` route), and `ImprovementProposalsController` (`apps/api/src/improvement/improvement-proposals.controller.ts`) exposes only GET / approve / reject / rollback / bulk — **no create route**. The web layer (`useImprovementProposals.ts`, `client.improvement-proposals.ts`) likewise has no create mutation.

**Design:** (D1) add a browser-facing `POST /improvement/proposals` create route for `skill_assignment` (operator-directed provenance); (D2) web client + hook create mutation; (D3) an "Assign skill" dialog in the Improvements queue with skill/target pickers (data from existing admin/workflow clients); (D4) wire the action + provenance display.

### Task D1: Backend create-route for operator-directed `skill_assignment`

**Files:**

- Modify: `apps/api/src/improvement/improvement-proposals.controller.ts` (add `POST /improvement/proposals`, guarded by the existing `improvements:manage` permission used by approve/reject)
- Modify/Create: a request DTO `CreateSkillAssignmentProposalDto` (Zod) — `{ skillName: string; targets: Array<{ type: 'agent_profile' | 'workflow_step'; profileName?: string; workflowName?: string; stepId?: string }>; rationale?: string }` (mirror `suggestSkillAssignmentSchema` in `suggest-skill-assignment.tool.ts` exactly — extract a shared schema in `@nexus/core` if it isn't already shared, to stay DRY).
- Modify: `ImprovementProposalService` only if needed — likely just call the existing `submitProposal`.
- Test: `improvement-proposals.controller.spec.ts`; governance test if provenance handling changes.

**Interfaces:**

- Consumes: `ImprovementProposalService.submitProposal({ kind: 'skill_assignment', payload, evidence, confidence, provenance })`.
- Produces: `POST /improvement/proposals` → created proposal (id, status).

- [ ] **Step 1 (Red):** Controller spec: a valid body creates a `skill_assignment` proposal via `submitProposal` with `provenance.source = 'ui_operator'` (new marker) and is guarded by `improvements:manage`; invalid targets are rejected by the DTO.
- [ ] **Step 2:** Verify fail.
- [ ] **Step 3 (Green):** Implement the route (transport only) → `submitProposal`. Reuse the shared assignment-target schema. Set provenance to an operator marker.
- [ ] **Step 4:** Verify pass.
- [ ] **Step 5:** `build:api` + `lint:api`. Commit (references FU-10/PD-4).

> **CONFIRM (the key governance decision):** an operator-directed proposal has no `struggle_backed`/`inference` evidence class, so the evidence-class confidence caps don't apply. This plan submits it with `provenance.source='ui_operator'` and lets the normal `skill_assignment` tier decide (auto-applies under `tiered`). If instead operator proposals should ALWAYS require explicit approval (never auto-apply), add a one-line rule in `ImprovementGovernancePolicyService` forcing `propose` when `provenance.source==='ui_operator'`. Pick one at review; Task D1's test pins whichever is chosen.

### Task D2: Web API client + create mutation hook

**Files:**

- Modify: `apps/web/src/lib/api/client.improvement-proposals.ts` (add `createSkillAssignmentProposal(body)`)
- Modify: `apps/web/src/hooks/useImprovementProposals.ts` (add a `useCreateSkillAssignmentProposal` mutation invalidating the proposals list query key)
- Modify: `apps/web/src/lib/queryKeys.ts` if a new key is needed (reuse the improvements list key for invalidation)
- Test: `client.improvement-proposals` spec + the hook spec (mirror the existing approve/reject mutation tests)

**Interfaces:**

- Produces: `useCreateSkillAssignmentProposal()` → mutation over `createSkillAssignmentProposal`.

- [ ] **Step 1 (Red):** Client spec asserting `createSkillAssignmentProposal` POSTs to `/improvement/proposals` with the body; hook spec asserting a successful create invalidates the proposals list.
- [ ] **Step 2:** Verify fail.
- [ ] **Step 3 (Green):** Implement client method + mutation hook.
- [ ] **Step 4:** Verify pass (`npm run test:unit:web -- improvement-proposals` narrowly).
- [ ] **Step 5:** `lint:web` clean. Commit.

### Task D3: "Assign skill" dialog with skill + target pickers

**Files:**

- Create: `apps/web/src/pages/improvements/AssignSkillDialog.tsx` (presentational form: skill picker, target-type toggle agent-profile/workflow-step, profile/workflow/step pickers, optional rationale; calls a passed `onSubmit`)
- Modify: `apps/web/src/pages/improvements/` container (the Improvements queue page) to add an "Assign skill" button opening the dialog and wiring `useCreateSkillAssignmentProposal`
- Reuse pickers' data: `client.admin.ts` `getAgentProfiles` / `getAgentSkills`, `client.workflow.ts` `getWorkflows` (existing hooks: `useAgentProfiles`, `useAgentSkills`, workflows hook) — no new backend for picker data.
- Test: `AssignSkillDialog.spec.tsx`

**Interfaces:**

- Consumes: `useAgentProfiles`, `useAgentSkills`, workflows hook, `useCreateSkillAssignmentProposal`.

- [ ] **Step 1 (Red):** Component spec: selecting a skill + an agent-profile target + submitting calls `onSubmit` with `{ skillName, targets:[{type:'agent_profile', profileName}], rationale? }`; workflow-step target path yields `{type:'workflow_step', workflowName, stepId}`; submit disabled until a skill + ≥1 valid target chosen.
- [ ] **Step 2:** Verify fail.
- [ ] **Step 3 (Green):** Build the dialog (presentational; side-effects via the passed mutation). Follow the existing improvements components' styling (`SkillAssignmentTargetList`, `SkillProposalDetail`).
- [ ] **Step 4:** Verify pass (`npm run test:unit:web -- AssignSkill` narrowly).
- [ ] **Step 5:** `lint:web` clean. Commit.

### Task D4: Wire the action into the queue + provenance display

**Files:**

- Modify: the Improvements queue container to render the button + dialog and show a success/pending state via the queue's existing patterns.
- Modify (optional): `SkillBindingProvenance.tsx` to render the `ui_operator` provenance source label for operator-created assignments.
- Test: the container spec (assert the button opens the dialog and a submit triggers the create mutation).

- [ ] **Step 1 (Red):** Container spec: clicking "Assign skill" opens the dialog; a submit invokes the create mutation with the composed body.
- [ ] **Step 2:** Verify fail.
- [ ] **Step 3 (Green):** Wire it; add the provenance label branch if trivial.
- [ ] **Step 4:** Verify pass (narrow web run).
- [ ] **Step 5:** `lint:web` + `build:web` clean. Commit (references FU-10).

### Task D5: Docs

**Files:**

- Modify: `docs/guide/48-improvement-pipeline.md` and/or `docs/guide/35-memory-learning.md` (the sections that say scope-confirmation "has no replacement yet ... deferred to a future Epic B") to document the new operator "Assign skill" flow and its governance treatment.

- [ ] **Step 1:** Update the guide sections; note the operator-directed provenance + governance decision from D1.
- [ ] **Step 2:** prettier-check clean. Commit.

---

## Deferred — NOT built in this plan (documented decisions)

### PD-2 · Post-apply probation watcher — DEFERRED

Auto-revert an applied definition-change if subsequent runs regress. Out of scope in the Epic D spec. The schema (`applied_at`, `rollback_data`, `provenance`, `rolled_back_at`) already supports adding it later without rework. Building it needs (a) a regression signal/metric vs a pre-apply baseline, (b) a probation window/threshold policy, (c) a watcher that calls the existing `applier.rollback(proposal)` and emits provenance. Revisit as its own spec when there's a concrete regression signal to key on.

### FU-23 · Repo-wide spec-mock type hygiene — BACKLOG TICKET

The repo's pervasive loose-spec-mock pattern (`{...} as SomeService`) is flagged by `tsc -p apps/api/tsconfig.json` but caught by no gate. This is a large mechanical sweep unrelated to this feature. **Action:** file a standalone ticket — "Type-safe spec mocks + `tsc --noEmit` spec gate": introduce typed mock factories / `satisfies`, sweep `apps/api/**/*.spec.ts`, and add a CI gate so it can't regress. Do it as its own focused effort, not folded into feature work.

---

## Suggested sequencing

1. **Independent quick wins first:** Workstream A (FU-16, 2 tasks) and Workstream B (PD-3, 2 tasks) — both small, isolated `apps/api` changes, parallelizable across sessions (disjoint files).
2. **Workstream C (PD-1)** — self-contained in `apps/kanban`, 4 tasks; do C1→C2→C3→C4 in order.
3. **Workstream D (PD-4/FU-10)** — largest; D1 (backend) must land before D2→D4 (web). Resolve the D1 governance CONFIRM before starting D1.
4. Confirm the Decisions Register with the user (especially the D1 governance treatment) before implementing D; A/B/C can proceed on their assumed decisions with low risk.

All four workstreams are independently landable and reviewable; none blocks another except the D1→D2 ordering within Workstream D.
