# Self-Improvement Pipeline — Design Spec

**Date:** 2026-07-02
**Status:** Approved (brainstormed + section-by-section review with project owner)

## 1. Context and Problem

The orchestrator can **diagnose** its own failures (EPIC-212 retrospective analyst) and it can
**mutate** its own configuration (runtime CRUD APIs for workflows and agent profiles, skill
materialization, the work-item implement→quality-gate→auto-merge pipeline for code). What is
missing is a **governed bridge between diagnosis and mutation**. Today:

- **Skills are created but orphaned.** The pipeline (analyst → `skill_proposal` → human approve →
  `create_skill` workflow → `POST /workflow-runtime/skills/materialize`) ends at a `SKILL.md` file.
  Nothing assigns the new skill to any agent profile, and no workflow/step-level skill binding
  exists at all. A created skill is inert until a human edits `agent_profiles.assigned_skills`.
- **There is no "assign existing skill" path.** When the analyst's similarity routing finds a
  close existing skill, it can only propose a patch to it — it cannot propose "profile X /
  workflow step Y should _receive_ skill Z".
- **Memory recall is scope-blind.** `MemorySegment` carries `entity_type`/`entity_id`, and an
  agent-scoped _write_ path already exists (`agent_preference` → `entity_type='agent'`), but
  `MemoryRetrievalService.fetchCandidateSegments` only ever fetches `project` + `global`. Agent-
  scoped memories are written and governed but never recalled. Workflow-definition targeting does
  not exist anywhere. Every agent draws from one shared pool.
- **The improvement loop cannot touch definitions or code.** `RetrospectiveOutputRouter` emits
  exactly two kinds (`memory`, `skill_proposal`). Structural findings ("this step's retry budget is
  unwinnable", "this profile lacks a tool grant", "this is a product bug") can at best become a
  memory _about_ the problem.
- **The one code-modifying loop is the least governed.** `apps/repair-agent` edits the codebase via
  opencode, commits, pushes, and rebuilds — with no confidence caps, no approval gate, and no
  ledger integration. It is currently unused and non-functional.

## 2. Decisions (from brainstorming)

| Decision                           | Choice                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Governance posture                 | **Configurable**: `tiered` (default) / `manual` / `autonomous`, plus per-kind overrides                                                |
| Skill↔workflow binding granularity | **Per step/job**, with a workflow-level default block; effective = profile ∪ workflow ∪ step                                           |
| Code-change execution path         | **Kanban work-item pipeline** on a self-referential project (existing merge gates), via a boundary-respecting neutral event            |
| Architecture                       | **Unified Improvement Proposal pipeline** (Approach A): one proposal family, one governance policy, one applier registry, one queue UI |
| `apps/repair-agent`                | **Delete entirely** (unused and broken) — no flag, no deprecation stub                                                                 |
| Memory targeting mechanism         | **Reuse the existing `entity_type`/`entity_id` scope key** (fix recall; add `workflow` scope) — no new tagging system                  |
| Memories in the proposal table     | **No** — memories stay on the existing `learning_candidates` promotion pipeline, which already has governance/probation                |

## 3. Architecture Overview

```
                       ┌────────────────────────────┐
 retrospective analyst │  RetrospectiveOutputRouter │──── memory ──────────► learning_candidates (existing)
 runtime tools ───────►│  + suggest_skill_assignment │
                       └─────────────┬──────────────┘
                                     │ skill_create / skill_assignment /
                                     │ workflow_definition_change /
                                     │ agent_profile_change / code_change
                                     ▼
                       ┌────────────────────────────┐
                       │  ImprovementModule          │
                       │  improvement_proposals      │
                       │  GovernancePolicyService    │──► auto_apply | propose | drop
                       │  Applier registry           │
                       └─────────────┬──────────────┘
             ┌───────────────┬───────┴───────┬──────────────────┐
             ▼               ▼               ▼                  ▼
   skill materialize   workflow_skill    workflow / profile   neutral event
   + assignments       _bindings         update APIs          improvement.task.requested
   (existing path)     (new table)       (+ rollback_data)         │
                                                                   ▼
                                                          Kanban consumer →
                                                          work item on self-project →
                                                          implement → gate → merge
```

## 4. Component Design

### 4.1 Improvement Proposal backbone (`ImprovementModule`)

New module at `apps/api/src/improvement/` owning:

**Entity `improvement_proposals`** (migrates and replaces
`apps/api/src/memory/database/entities/skill-improvement-proposal.entity.ts`; existing rows are
migrated with `kind='skill_create'`, the old table is dropped, and the old entity/repository/
controller are deleted — no re-exports):

| Column                          | Type                 | Notes                                                                                                           |
| ------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`                            | uuid                 |                                                                                                                 |
| `kind`                          | varchar enum         | `skill_create` \| `skill_assignment` \| `workflow_definition_change` \| `agent_profile_change` \| `code_change` |
| `status`                        | varchar enum         | `pending` \| `approved` \| `rejected` \| `applied` \| `failed` \| `rolled_back`                                 |
| `payload`                       | jsonb                | Typed per kind (Zod schemas in `packages/core` if shared with web, else module-local)                           |
| `evidence`                      | jsonb                | Run ids, failure classes, event-ledger refs, evidence class (`struggle_backed` \| `inference`)                  |
| `confidence`                    | float                | Router-derived (never analyst self-reported)                                                                    |
| `rollback_data`                 | jsonb nullable       | Pre-apply snapshot, written by appliers before mutation                                                         |
| `occurrence_count`              | int default 1        | Bumped by dedup instead of creating duplicates                                                                  |
| `provenance`                    | jsonb                | Source workflow run, analyst version, producing tool                                                            |
| `applied_at` / `rolled_back_at` | timestamptz nullable |                                                                                                                 |
| timestamps                      |                      | `created_at`, `updated_at`                                                                                      |

**`ImprovementGovernancePolicyService`** resolves `(kind, evidenceClass, confidence)` →
`auto_apply | propose | drop` from two settings (settings-table pattern, like
`retrospective-enabled.settings.ts`):

- `improvement_governance_mode`: `tiered` (default) | `manual` | `autonomous`
- `improvement_governance_overrides` (jsonb): per-kind mode override

Resolution rules:

1. Existing evidence-class confidence caps are **kept in all modes**: struggle-backed capped at
   0.7, pure inference at 0.45; apply floor 0.5 (constants shared with the memory promotion
   governance policy — extract to a shared constants module, do not duplicate).
2. `manual`: everything that clears the drop floor becomes `propose`.
3. `tiered` (default): `skill_assignment` → `auto_apply`; `skill_create`,
   `workflow_definition_change`, `agent_profile_change`, `code_change` → `propose`.
4. `autonomous`: everything above the apply floor → `auto_apply`; below the floor → `propose`
   (never silently applied). For `code_change`, `auto_apply` means _the work item is filed
   automatically_ — the code itself always passes the quality-gate/merge pipeline.

**Applier registry**: `IImprovementApplier` interface (`supports(kind)`, `apply(proposal)`,
`rollback(proposal)` where meaningful), registered via a DI token multi-provider — the same shape
as the special-step handler registry. Every applier: writes `rollback_data` (when applicable)
**before** mutating, emits event-ledger audit entries (`EventLedgerService.emitBestEffort`) for
apply/fail/rollback, and is idempotent on retry.

**API** (`improvement-proposals.controller.ts`, RBAC-guarded): list/filter, get, approve, reject,
bulk-approve, rollback. Approving a proposal invokes its applier; applier failure sets
`status='failed'` with the error recorded in `provenance`.

**Producers**: `RetrospectiveOutputRouter` gains the new kinds (see per-feature sections). The
router keeps its existing rails: confidence re-derivation, credential redaction, no self-elected
global scope.

### 4.2 Skills — create-with-assignment and assign-existing

**`skill_create` payload extension**: adds
`assignment_targets: Array<{type:'agent_profile', profileName} | {type:'workflow_step', workflowName, stepId?}>`
(a `workflow_step` target with no `stepId` means the workflow-level default block). The
retrospective analyst prompt is extended to propose targets from the run context it already has
(struggling profile + workflow). The router validates targets against existing profiles/workflows
and strips invalid ones with a ledger note.

**Apply path for `skill_create`**: run the existing materialization (approved-listener →
`create_skill` workflow → materialize endpoint) and then apply `assignment_targets`:
profile targets via `AgentSkillsService.addProfileSkills`; workflow targets via
`workflow_skill_bindings` (below). The `SkillProposalCompletionListener` equivalent moves into the
`skill_create` applier's completion handling so a created skill is never left unassigned.

**New kind `skill_assignment`**: payload `{skillName, assignment_targets}`. Producers:

1. **Analyst/router**: `LearningRouterService` already loads the skill corpus for
   `skill_new`/`skill_patch` similarity routing. New branch: when similarity to an existing skill
   is high **and** the struggling profile/workflow does not already have it, emit
   `skill_assignment` instead of a near-duplicate `skill_new`.
2. **Runtime internal tool `suggest_skill_assignment`** (workflow-internal-tools): any agent that
   notices a gap mid-run files a proposal; the tool resolves run context for provenance. The tool
   creates a proposal — it never assigns directly.

Apply path: same assignment mechanics as `skill_create`, plus rollback support (remove the
assignments recorded in `rollback_data`).

**Workflow-step skill binding surface** (new granularity):

- **Hand-authored YAML**: workflow-level `skills: [name, ...]` block plus `steps[].inputs.skills`.
  Parsed and validated by the workflow parser (unknown skill names are a validation warning, not an
  error — skills may be created later).
- **Runtime-assigned**: new table `workflow_skill_bindings`
  (`id`, `workflow_name`, `step_id` nullable, `skill_name`, `provenance` jsonb, timestamps;
  unique on `(workflow_name, step_id, skill_name)`). Runtime assignments write here rather than
  mutating `yaml_definition`, so they survive reseed, are individually listable/revocable, and do
  not fight the seed's `overrides`-skip logic.
- **Effective skills for a step** = profile `assigned_skills` ∪ workflow YAML skills (workflow
  block + step block) ∪ bindings (workflow-level + step-level), deduped by name.
- **Injection precedence**: the existing native-mode inline machinery
  (`renderInjectedSkillContent`, `SKILL_CONTENT_BUDGET_TOKENS` = 6000) fills **most-specific
  first**: step-scoped → workflow-scoped → profile-scoped. Overflow continues to degrade to
  name-only listing. Implemented in the shared prompt-layer helper
  (`universal-prompt-layers.helpers.ts` / `skill-content-injection.helpers.ts`) so **both the step
  executor and subagent provisioning paths** get identical behavior (known divergence risk).
  Container skill mounting (`skill-mounting.service.ts`) mounts the effective union.

**Store-split fix (bug, folded in)**: the materialize path
(`AgentSkillsService.upsertSkill` via `POST /workflow-runtime/skills/materialize`) additionally
upserts the `skills` DB row (`source='agent_factory'`), so the router's similarity corpus
(`loadSkillCorpus`) sees auto-created skills immediately. Without this, the corpus proposes
duplicates of skills it cannot see.

**Existing quirk to reconcile**: `workflow-runtime-capability-lifecycle.service.ts` `createSkill`
auto-assigns to the _caller's own_ profile. That behavior is kept but rerouted to file a
`skill_assignment` proposal in `manual` mode (auto-apply in `tiered`/`autonomous`), so all
assignment flows share one audit trail.

### 4.3 Memory targeting

**Recall union fix** in `MemoryRetrievalService.fetchCandidateSegments`
(`apps/api/src/memory/signals/memory-retrieval.service.ts`): candidate pool becomes

```
global + project(scopeId) + agent(currentAgentProfileName) + workflow(currentWorkflowName)
```

Agent profile name and workflow definition name are resolved from the step context already
threaded into the retrieval call (`StepSupportService.buildPromotedLearningContext` →
`resolvePromotedLessonsForInjection`). Downstream ranking (embedding RRF, recency, usefulness,
pinned boost, token-budget trim) is unchanged; scoped memories simply enter the candidate pool
only when their target matches. The legacy fallback path gets the same union.

**New scope `workflow`**: `entity_type='workflow'`, `entity_id=<workflow definition name>`. One
new branch in `resolveSegmentDestination` (`learning-promotion.helpers.ts`); the promotion
governance policy treats it like `project` scope for confidence thresholds.

**`remember` tool**: `scope` param gains `agent` and `workflow` values; ids auto-resolved from run
context (`context.agentProfileName`, workflow name from the run record) so agents never supply raw
ids.

**Analyst routing**: `scope_hint` vocabulary extended with `workflow_specific` → workflow scope
(existing `agent_preference` → agent scope unchanged). Rails unchanged: never self-elected
`global`; credential-bearing content forced to `project`.

**Deliberate simplifications**:

- A memory targets **one** scope (no tag lists). Genuinely multi-workflow knowledge is project
  scope.
- Skill-scoped recall (`entity_type='skill'` exists in data) is a **noted future extension** —
  inject memories for skills assigned to the current step — not built now.
- Governance (probation, contradiction/supersede, feedback-weight tuning) operates on segments
  regardless of scope and applies to the new scopes with no changes.

### 4.4 Workflow / agent-profile definition changes

**Kind `agent_profile_change`**: payload is a field-level patch — `system_prompt`
(append/replace), model, thinking level, tool grants, `assigned_skills`. Applied through the
existing agent-profile service path (same validation and RBAC as human edits).

**Kind `workflow_definition_change`**: payload is the **full proposed `yaml_definition`** plus a
structured change summary (`{stepId?, field, from, to, rationale}[]`). Full-YAML rather than
JSON-patch: it is what the update API takes, diffs render trivially, and YAML-patch application is
a fragile dependency. Applied via the existing workflow update path. The apply marks the row so
reseed does not clobber it (existing `overrides`/`locked` skip semantics in `workflows.seed.ts` —
the applier sets an override marker recording proposal provenance).

**Rollback is first-class**: appliers snapshot the pre-change definition into `rollback_data`
before writing; `POST /improvement-proposals/:id/rollback` restores it, sets
`status='rolled_back'`, and emits a ledger entry. This is version-history-lite; a full versioning
system is out of scope.

**Confidence posture**: `tiered` → always propose. `autonomous` → may auto-apply, but only
struggle-backed evidence can reach the 0.5 floor (the 0.45 inference cap keeps speculation below
it).

**Post-apply probation (phase 2, designed-for, not built)**: applied changes carry provenance +
`applied_at` + target identity + `rollback_data`, so a later watcher can compare failure rates N
runs before/after an auto-applied change and auto-rollback on regression. Schema supports it from
day one; the watcher is deferred.

**Analyst prompt** extended to emit these kinds when evidence points at the definition rather than
missing knowledge (unwinnable retry budgets, missing tool grants, wrong model/thinking tier).

### 4.5 Code changes via the work-item pipeline

**Kind `code_change`**: payload is a structured engineering brief — `title`, `description`,
`suspectedArea` (files/modules when the analyst can tell), `evidence` (run ids, failure classes,
ledger refs), `severity`.

**Boundary-respecting bridge** (API/core stays Kanban-neutral):

1. The `code_change` applier emits a neutral domain event `improvement.task.requested` via the
   existing outbox → core lifecycle stream, carrying the brief. It never touches Kanban.
2. A new **Kanban-side consumer** (`apps/kanban`) subscribes, reads Kanban setting
   `self_improvement_project_id`, and creates a work item on that project. The project is a normal
   Kanban project whose repository is the Nexus Orchestrator repo itself (repo import already
   supports this); configuring it is a **documented onboarding step**, not a hard seed.
3. If no project is configured, the consumer parks the event with a warning and the proposal
   surfaces as `applied` with an `unrouted` marker in provenance — never a silent drop.
4. From the work item onward it is the existing machinery end-to-end: dispatch → implement →
   quality gate → auto-merge.

**Dedup**: before filing, the applier embeds the brief and checks similarity against recent
pending/applied `code_change` proposals (same embedding technique as the skill corpus). A match
bumps `occurrence_count` on the existing proposal instead of creating a new one — recurring
failure classes become a prioritization signal, not work-item spam.

**`apps/repair-agent` is deleted entirely**: the app directory, its workspace entry, docker
compose service (port 8765), Makefile/build scripts, docs references (README, docs/guide,
operations runbooks, port table), and the telemetry websocket wiring that fed it. No flag, no
deprecation stub. Telemetry signals that drove it are already covered by the retrospective
pipeline's terminal-run enqueue.

### 4.6 Web UI

Extends the existing admin surface (`apps/web`):

- **Improvements queue page**: list/filter by kind/status/confidence; approve / reject /
  bulk-approve; per-kind detail rendering — YAML diff for `workflow_definition_change`, field diff
  for `agent_profile_change`, skill preview + target list for skill kinds, brief + linked-run
  evidence for `code_change`; rollback button on applied definition changes. The API-only skill
  proposal queue folds into this page.
- **Governance settings panel**: global mode selector + per-kind override table.
- **Provenance surfacing**: agent profile editor and workflow detail views show skills arriving
  via bindings/proposals ("assigned by proposal #N"), so runtime assignments are visible where a
  human would look for them.

## 5. Epic Decomposition

| Epic                       | Scope                                                                                                                                                                                                                                                        | Depends on                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| **A — Proposal backbone**  | `ImprovementModule`, `improvement_proposals` (+ migration of skill proposals), governance policy + settings, applier registry, audit, proposals API, queue UI skeleton                                                                                       | —                               |
| **B — Skill assignment**   | `assignment_targets` on `skill_create`, `skill_assignment` kind + producers, `workflow_skill_bindings` + YAML `skills:` + injection precedence (step **and** subagent paths), store-split fix, `suggest_skill_assignment` tool, capability-lifecycle reroute | A                               |
| **C — Memory targeting**   | Recall union fix (agent + new workflow scope), `remember` scope values, analyst `scope_hint` extension, promotion destination branch                                                                                                                         | — (independent; can ship first) |
| **D — Definition changes** | `workflow_definition_change` + `agent_profile_change` kinds, full-YAML diff + rollback, reseed protection, analyst prompt extension                                                                                                                          | A                               |
| **E — Code-change bridge** | `code_change` kind, neutral event → Kanban consumer → self-project work item, dedup, **repair-agent deletion**, onboarding doc                                                                                                                               | A                               |

B and C are parallelizable; D and E depend only on A.

## 6. Testing Strategy

- **TDD throughout** (project convention). Unit tests per service with mocked repositories
  (existing Vitest/NestJS patterns in `testing-unit-patterns`).
- **Governance policy**: exhaustive table-driven tests over (mode × kind × evidence class ×
  confidence) → action.
- **Appliers**: apply/rollback round-trip tests; idempotency on retry; `rollback_data` written
  before mutation (failure-injection test).
- **Injection precedence**: characterization tests asserting step ∪ workflow ∪ profile union and
  most-specific-first budget fill, run against **both** the step-executor and subagent prompt
  paths.
- **Recall union**: retrieval tests proving agent-/workflow-scoped segments appear only for
  matching context and never leak cross-workflow.
- **Boundary**: lint rule `nexus-boundaries/no-core-kanban-residue` must stay green — the
  `code_change` applier emits neutral events only; Kanban consumer tests live in `apps/kanban`.
- **Migration**: skill-proposal migration test (rows preserved, statuses mapped, old table gone).
- **E2E**: one flow per epic (e.g. approve a `skill_assignment` proposal → skill appears in the
  step prompt on the next run).

## 7. Risks and Mitigations

| Risk                                                          | Mitigation                                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Autonomous mode applies a bad definition change               | Confidence floor + struggle-backed-only reach; first-class rollback; phase-2 probation watcher designed in  |
| Prompt token bloat from step + workflow + profile skill union | Existing `SKILL_CONTENT_BUDGET_TOKENS` cap with most-specific-first fill; overflow degrades to name listing |
| Step/subagent path divergence recurs                          | Single shared helper for effective-skill resolution + characterization tests on both paths                  |
| Reseed clobbers applied definition changes                    | Applier sets `overrides` marker (existing seed-skip semantics); test covers reseed-after-apply              |
| Work-item spam from recurring failures                        | Embedding dedup + `occurrence_count`                                                                        |
| Analyst proposes assignments to nonexistent targets           | Router-side validation strips invalid targets with ledger note                                              |
| Migration breaks in-flight skill proposals                    | Migration maps all existing statuses; approved-listener updated in the same epic (A)                        |

## 8. Out of Scope (explicitly deferred)

- Post-apply probation watcher with auto-rollback (phase 2; schema supports it)
- Skill-scoped memory recall (inject memories for skills on the current step)
- Multi-target memories (tag lists)
- Full workflow/profile version history (rollback snapshots only)
- Deleting `workflow-repair` operational repair (unchanged; only `apps/repair-agent` is removed)
