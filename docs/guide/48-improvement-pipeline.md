# Improvement Proposal Pipeline (Epics A, B, D & E)

The improvement-proposal pipeline is the unified successor to the old
skill-proposal-specific flow described historically in [35 — Memory &
Learning Systems](35-memory-learning.md#skill-improvement-proposals-retired).
Instead of a bespoke table/service/controller for skill patches only, every
kind of self-improvement the system can propose — a new skill, a skill
assignment, a workflow definition change, an agent profile change, or a code
change — flows through one `ImprovementProposal` entity, one governance
policy, and one REST surface. Epic A shipped the entity, governance, the
applier registry pattern, the REST API, and the web queue page, with a single
concrete applier (`skill_create`). **Epic B adds the `skill_assignment`
applier** — binding an existing (or newly-materialized) skill to an agent
profile or a workflow/step, backed by a new runtime-only
`workflow_skill_bindings` table and a shared `resolveEffectiveSkills` helper
that both the step-executor and subagent paths now use (see
[Skill Assignment](#skill-assignment-epic-b) below). **Epic D adds the two
remaining definition-mutating appliers** — `agent_profile_change` and
`workflow_definition_change` — plus retrospective-analyst routing for both
and kind-specific web review UI (patch/YAML diff + rollback) — see
[Definition-Change Proposals](#definition-change-proposals-epic-d) below.
**Epic E adds the fifth and final applier kind, `code_change`** — a
Kanban-neutral bridge that turns an approved engineering brief into a work
item on a configurable project, via a neutral lifecycle-stream event rather
than any direct API→Kanban dependency — see
[Code-Change Bridge](#code-change-bridge-epic-e) below.

## Data model

**Entity**: `ImprovementProposal` (`apps/api/src/improvement/database/entities/improvement-proposal.entity.ts`),
table `improvement_proposals`, indexed on `(kind, status)` and `(status, created_at)`.

| Column                          | Type                           | Notes                                                                    |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| `id`                            | uuid PK                        |                                                                          |
| `kind`                          | varchar(48)                    | see kinds below                                                          |
| `status`                        | varchar(32), default `pending` | see statuses below                                                       |
| `payload`                       | jsonb                          | kind-specific proposal body (e.g. `target_skill_name`, `patch_markdown`) |
| `evidence`                      | jsonb                          | `{ evidenceClass, runIds?, failureClasses?, ledgerRefs? }`               |
| `confidence`                    | double precision, default 0    | re-derived by governance, never trusted from the source verbatim         |
| `rollback_data`                 | jsonb, nullable                | applier-owned undo payload                                               |
| `occurrence_count`              | integer, default 1             | recurrence counter for deduped proposals                                 |
| `provenance`                    | jsonb, default `{}`            | source run/candidate/listener bookkeeping                                |
| `applied_at` / `rolled_back_at` | timestamptz, nullable          |                                                                          |
| `created_at` / `updated_at`     | timestamptz                    | standard TypeORM timestamps                                              |

**`kind`** (`packages/core/src/improvement/improvement-proposal.types.ts`,
`IMPROVEMENT_PROPOSAL_KINDS`): `skill_create | skill_assignment |
workflow_definition_change | agent_profile_change | code_change`.

**`status`** (`IMPROVEMENT_PROPOSAL_STATUSES`): `pending | approved |
rejected | applied | failed | rolled_back`.

The same core module also defines `GovernanceMode = "tiered" | "manual" |
"autonomous"`, `GovernanceAction = "auto_apply" | "propose" | "drop"`, and
`ImprovementEvidenceClass = "struggle_backed" | "inference"` — the vocabulary
the governance policy below operates on.

### Migration

`apps/api/src/database/migrations/20260713000000-create-improvement-proposals.ts`
(`CreateImprovementProposals20260713000000`):

1. Creates `improvement_proposals` with the columns/indexes above.
2. **Backfills** from the legacy `skill_improvement_proposals` table if it
   still exists (guarded by `to_regclass('public.skill_improvement_proposals')`
   so the migration is a no-op on a database where it was already dropped).
   Every legacy row becomes a `kind='skill_create'` proposal: the skill
   fields (`target_skill_name`, `proposal_title`, `proposal_summary`,
   `patch_markdown`, `rationale`) fold into `payload` (plus an empty
   `assignment_targets: []`), `evidence` becomes
   `{evidenceClass:'inference'}`, `confidence` starts at `0`, and
   `provenance` records `migrated_from`, `learning_candidate_id`,
   `generated_from_run_id`, and `diagnostics`. Legacy statuses outside
   `pending/approved/rejected/applied/failed` collapse to `pending`. The
   insert is `ON CONFLICT (id) DO NOTHING`.
3. **Drops** `skill_improvement_proposals` unconditionally.

The `down()` migration is intentionally irreversible — it only drops
`improvement_proposals` and does not attempt to resurrect the legacy table.

## Governance

`ImprovementGovernancePolicyService`
(`apps/api/src/improvement/governance/improvement-governance-policy.service.ts`)
delegates to the pure function `decideGovernanceAction` in
`improvement-governance-policy.helpers.ts`, so the decision logic is
independently unit-testable of any DI/DB concerns.

**Mode** — one of `tiered` (default), `manual`, `autonomous` — is read from
the `improvement_governance_mode` system setting
(`IMPROVEMENT_GOVERNANCE_MODE_KEY`). A per-kind override map lives under the
`improvement_governance_overrides` setting
(`IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY`, default `{}`), e.g.
`{"workflow_definition_change":"manual"}` — an override for a kind wins over
the global mode (`overrides[kind] ?? mode`).

**Confidence caps by evidence class** — applied in every mode, before any
mode-specific rule, as defense-in-depth against an inflated self-reported
confidence:

| Evidence class    | Cap  | Setting                                  |
| ----------------- | ---- | ---------------------------------------- |
| `struggle_backed` | 0.7  | `retrospective_confidence_struggle_cap`  |
| `inference`       | 0.45 | `retrospective_confidence_inference_cap` |

These are the **same** settings the EPIC-212 retrospective router already
uses (see [35 — Memory & Learning Systems](35-memory-learning.md)) —
deliberately reused rather than duplicated, so operators tune one knob for
both loops.

**`ui_operator` exemption (FU-10/PD-4)**: the confidence cap above exists to
discourage trusting an inflated _self-reported_ confidence from an
LLM/heuristic producer. It does not apply to a proposal explicitly created
by a human through the web "Assign skill" flow
(`provenance.source === 'ui_operator'` **and** `kind === 'skill_assignment'`
— see [Human-Facing Assign Skill Flow](#human-facing-assign-skill-flow-fu-10pd-4)
below) — a human choosing to assign a skill carries no `struggle_backed`/
`inference` evidence class of its own, so `decideGovernanceAction` skips the
cap for it and lets the normal `skill_assignment` tier decide (auto-applies
under the default `tiered` mode, same as every other `skill_assignment`
proposal). The exemption is deliberately narrow — scoped to `skill_assignment`
specifically via `CAP_EXEMPT_OPERATOR_KIND`
(`apps/api/src/improvement/governance/improvement-governance-policy.helpers.ts`)
— so a higher-risk kind (`code_change`, `workflow_definition_change`,
`agent_profile_change`) that ever carried a `ui_operator` marker would still
be capped by its evidence class; this is an **exemption from the cap**, not
from governance altogether — `manual` mode still forces `propose` for a
`ui_operator` proposal exactly as it would for any other `skill_assignment`
proposal.

**Decision logic** (`decideGovernanceAction`):

1. Cap `confidence` to the evidence-class ceiling above.
2. If the capped confidence is `<= 0` → `drop` (short-circuits before any
   mode dispatch — a zero-confidence proposal is never even shown to a
   human).
3. Resolve the effective mode (per-kind override or global mode).
4. `manual` → always `propose` (create as `pending`, wait for a human).
5. `tiered` → `auto_apply` only for kinds in the auto-apply allowlist
   (`skill_assignment` today); every other kind → `propose`.
6. `autonomous` → `auto_apply` if the capped confidence is `>= 0.5` (the
   same `GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR` the pre-existing
   learning-promotion governance uses), else `propose`.

## Applier registry

`IImprovementApplier` (`apps/api/src/improvement/appliers/improvement-applier.types.ts`)
is the extension point new proposal kinds implement:

```ts
interface IImprovementApplier {
  readonly kind: ImprovementProposalKind;
  apply(proposal: ImprovementProposal): Promise<ImprovementApplyResult>;
  rollback?(proposal: ImprovementProposal): Promise<void>; // optional
}
// ImprovementApplyResult = { ok: boolean; detail?: string; unrouted?: boolean }
```

`ImprovementApplierRegistry` collects every bound applier (injected as
`IImprovementApplier[]` via the `IMPROVEMENT_APPLIERS` DI token) into a
`Map` keyed by `.kind`, exposing `get(kind)` (undefined-safe lookup) and
`require(kind)` (throws `no applier registered for kind '<kind>'`).
`ImprovementModule` wires `IMPROVEMENT_APPLIERS` as a factory provider;
as of Epic D it resolves to a four-element array (`[SkillCreateApplier,
SkillAssignmentApplier, AgentProfileChangeApplier,
WorkflowDefinitionChangeApplier]`) — only `code_change` still has no applier,
so `require()` throws for it until Epic E lands it.
`rollback()` is optional per-applier; `ImprovementProposalService.rollback()`
raises a `ConflictException` if the resolved applier doesn't implement it.

**`SkillCreateApplier`** (`appliers/skill-create.applier.ts`, `kind:
'skill_create'`) reads `target_skill_name` / `patch_markdown` /
`proposal_summary` off `proposal.payload` and dispatches the `create_skill`
workflow (`WorkflowEngineService.startWorkflow`) with `source_proposal_id`
and `scope_id` (from `proposal.provenance.scope_id`) threaded through as
state variables. It returns immediately after dispatch (`{ ok: true, detail:
'materialization dispatched (run <runId>)' }`) — completion is asynchronous.
It also logs a count of valid `assignment_targets` on the payload (parsed via
`parseAssignmentTargets`), but does not apply them directly — a skill can
only be bound to a profile/workflow once it exists on disk, so application is
deferred to the completion listener below. No `rollback()` yet.

**Completion detection** — `SkillCreateCompletionListener`
(`apps/api/src/improvement/skill-create-completion.listener.ts`) listens on
the workflow-run-completed event, finds the originating proposal via
`trigger.source_proposal_id` in the run's state variables, and reads
`jobs.author_skill.output.materialized`:

- `materialized === true` → the proposal (already optimistically `applied`
  at dispatch time) is reconfirmed/enriched with
  `provenance.materialization`, and — only when the
  `skill_scope_confirmation_mode` system setting is `auto` — the
  recommended scope is auto-applied to the new skill's frontmatter
  (fail-soft; errors are logged, not thrown). It then applies any
  `assignment_targets` on the payload via `applyAssignmentTargets()` (see
  [Skill Assignment](#skill-assignment-epic-b) below) and persists the
  resulting binding provenance to `rollback_data`.
- anything else → the proposal is downgraded to `status: 'failed'`, with
  `provenance.materialization.error_message` recording the rejection
  reason. Assignment targets are not applied for a failed materialization.

**`SkillAssignmentApplier`** (`appliers/skill-assignment.applier.ts`, `kind:
'skill_assignment'`) binds an **already-existing** skill to targets —
covered in full in [Skill Assignment](#skill-assignment-epic-b) below.

## Skill Assignment (Epic B)

Epic B adds a second way a skill reaches an agent, alongside seed-authored
`agent.json` skill lists: a **governed runtime assignment**, either to an
agent profile or to a specific workflow (optionally scoped to one step).

### `AssignmentTarget`

Defined in `packages/core/src/improvement/improvement-proposal.types.ts`:

```ts
type AssignmentTarget =
  | { type: "agent_profile"; profileName: string }
  | { type: "workflow_step"; workflowName: string; stepId?: string }; // no stepId = whole-workflow
```

Every producer's raw (agent- or LLM-sourced) target list is re-validated
through `parseAssignmentTargets(raw)` and split with
`partitionAssignmentTargets(targets)`
(`apps/api/src/improvement/appliers/assignment-target.helpers.ts`) before
anything is applied — malformed or hallucinated entries are silently
dropped, never trusted verbatim. Targets are de-duplicated by structural
equality.

### `workflow_skill_bindings` table

Migration `20260714000000-create-workflow-skill-bindings.ts`; entity
`WorkflowSkillBinding` (`apps/api/src/workflow/workflow-skill-bindings/workflow-skill-binding.entity.ts`).

| Column                      | Type              | Notes                           |
| --------------------------- | ----------------- | ------------------------------- |
| `id`                        | uuid PK           |                                 |
| `workflow_name`             | varchar           |                                 |
| `step_id`                   | varchar, nullable | `NULL` = whole-workflow binding |
| `skill_name`                | varchar           |                                 |
| `provenance`                | jsonb, nullable   | e.g. `{ proposalId }`           |
| `created_at` / `updated_at` | timestamptz       |                                 |

A unique index on `(workflow_name, COALESCE(step_id, ''), skill_name)`
de-dupes whole-workflow bindings correctly — Postgres treats plain `NULL`
values as distinct under an ordinary unique constraint, so the index
expression is required (and isn't expressible via TypeORM decorators, so
it's raw SQL in the migration; the entity only declares a supporting
non-unique index on `workflow_name`).

This table is deliberately **separate from `workflows.yaml_definition`** —
runtime assignments made by the self-improvement pipeline survive a workflow
reseed, which only touches the YAML-sourced definition. This is distinct
from the author-time `skills:` YAML surface described in
[06 — Workflow Engine](06-workflow-engine.md#skill-assignment-skills-yaml-surface),
which _is_ reset on reseed.

`WorkflowSkillBindingService`
(`apps/api/src/workflow/workflow-skill-bindings/workflow-skill-binding.service.ts`,
provided by `WorkflowSkillBindingsModule`) exposes `addBinding()` (idempotent
— checks for an existing row first), `removeBinding()`, and
`listForWorkflow(workflowName)`.

### `resolveEffectiveSkills` — the shared precedence helper

`apps/api/src/workflow/agent-prompt/effective-skills.helpers.ts` exports a
pure function:

```ts
function resolveEffectiveSkills(sources: {
  profileSkills: string[];
  workflowYamlSkills: string[];
  stepYamlSkills: string[];
  workflowBindings: string[];
  stepBindings: string[];
}): Array<{ name: string; specificity: "step" | "workflow" | "profile" }>;
```

It unions all five skill-name sources (deduped by name) and tags each
resolved skill with its **most specific** origin — step-level sources win
over workflow-level, which win over the agent profile — sorting the result
step-first so the prompt-injection token budget fills the most specific
skills first.

This is wrapped by a single call-through entry point,
`resolveAgentAssignedSkills` (`agent-prompt/agent-assigned-skills.helpers.ts`),
which additionally fetches bindings from `WorkflowSkillBindingService`,
partitions them into workflow- vs. step-scoped, and hydrates each resolved
name back into a full skill record. **Both** of the previously-divergent
skill-resolution paths now call through this one helper:

- **Step executor**: `workflow-step-execution/step-agent-effective-skills.helpers.ts`
  → invoked from `step-agent-step-executor.service.ts`.
- **Subagent provisioning**: `workflow-subagents/subagent-orchestrator.skills.helpers.ts`
  → invoked from `subagent-orchestrator.spawn.skill-mount.ts`.

This closes a long-standing bug class (the step vs. subagent path
divergence — see [09 — Workflow Subagents](09-workflow-subagents.md)) where
the two paths re-implemented skill resolution independently and drifted.
The subagent path threads the spawning step's YAML id through
`SubagentSpawnParams.parent_step_id` (FU-5), so **step-scoped** YAML
skills/bindings reach subagents the same way they reach the step executor —
only subagents spawned outside a step context (no `parent_step_id`) fall
back to workflow-level-only sources.

### `suggest_skill_assignment` agent tool

An agent-facing runtime tool
(`apps/api/src/workflow/workflow-internal-tools/tools/skill/suggest-skill-assignment.tool.ts`,
tier-1, `api_callback` transport) that lets an agent request binding an
existing skill to one or more targets:

```ts
{
  skill_name: string;          // 1-128 chars
  targets: AssignmentTarget[]; // min 1
  rationale?: string;          // optional, max 2000 chars
}
```

It **never** applies the binding directly — it always files a governed
`skill_assignment` proposal via `ImprovementProposalService.submitProposal`
(default confidence `0.5`, `evidenceClass: 'inference'`), so it goes through
the same governance decision (tiered/manual/autonomous) as every other
proposal kind. The HTTP callback lands on
`POST /workflow-runtime/learning/proposals/suggest-assignment`
(`skills:create` permission). Seeded onto `memory-learning-sweep` and
granted to `ceo-agent` alongside `create_skill_proposal`.

### `SkillAssignmentApplier`

`apps/api/src/improvement/appliers/skill-assignment.applier.ts` — `apply()`
rejects (`{ ok: false }`) if `payload.skillName` is missing or the skill
doesn't exist yet (`AgentSkillsService.skillExists`); otherwise it calls the
same `applySkillAssignments()` helper `SkillCreateApplier`'s completion
listener uses (shared — "routing a resolved target is identical whether the
skill was just materialized or already existed"), which for each target
calls either `AgentSkillsService.addProfileSkillsByProfileName` (`agent_profile`
targets) or `WorkflowSkillBindingService.addBinding` (`workflow_step`
targets). Each target is applied independently — a failure on one produces
an `unrouted` outcome (with a reason) rather than aborting the whole batch.
`apply()` reaches `status: 'applied'` synchronously (no materialization step
is needed); `rollback()` reverses each previously-applied target using the
persisted `rollback_data.applied_targets`.

### Retrospective router: `skill_create` vs. `skill_assignment`

`RetrospectiveOutputRouter.routeSkillProposal()`
(`apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.ts`)
— not the LLM analyst — makes the kind decision: it derives a candidate
skill slug from the finding, and checks `AgentSkillsService.skillExists()`.
If a skill with that name already exists, emitting another `skill_create`
would just create a near-duplicate, so the router emits `skill_assignment`
instead (binding the existing skill to the analyst's suggested targets);
only a genuinely new skill name gets `skill_create`. Either way, the
analyst's optional `assignment_targets` are re-validated through
`parseAssignmentTargets` before reaching the payload.

### Human-Facing Assign Skill Flow (FU-10/PD-4)

The `suggest_skill_assignment` agent tool and the retrospective router
(above) are both _agent/analyst_-initiated. FU-10/PD-4 adds the third,
**human**-initiated producer: an operator explicitly choosing "assign this
skill to that agent/workflow" from the web Improvements queue.

**Backend — `POST /improvement/proposals`**
(`ImprovementProposalsController.create`,
`apps/api/src/improvement/improvement-proposals.controller.ts`), guarded by
the same `improvements:manage` permission as approve/reject/rollback. Body:

```ts
{
  skillName: string;                   // 1-128 chars
  targets: AssignmentTarget[];         // min 1 — same shared schema the
                                        // agent tool uses (see below)
  rationale?: string;                  // optional, max 2000 chars
}
```

validated by `createSkillAssignmentProposalSchema`
(`packages/core/src/improvement/improvement-proposal-contracts.schema.ts`),
which composes the shared `assignmentTargetSchema`
(`packages/core/src/improvement/assignment-target.schema.ts`) — the same
schema `suggest_skill_assignment` validates against, kept in `@nexus/core`
so both producers can never drift. The route calls the same
`ImprovementProposalService.submitProposal({ kind: 'skill_assignment', ... })`
entry point every other producer uses, with two differences: `confidence`
is set to `1` and `evidence.evidenceClass` to `inference` (the closest fit —
see the **`ui_operator` exemption** in [Governance](#governance) above,
which is what actually makes the maximal confidence stick), and
`provenance.source` is set to the `'ui_operator'` marker
(`UI_OPERATOR_PROVENANCE_SOURCE`,
`apps/api/src/improvement/improvement-proposal-provenance.constants.ts`).

**Response envelope** — unlike every sibling improvement-proposal endpoint
(`{ success, data }`), this route returns `{ success, outcome, data }`:
`outcome` is `SubmitProposalResult['outcome']`
(`'auto_applied' | 'proposed' | 'dropped' | 'apply_failed'`) — the operator
needs to know what governance actually did with their request, not just
that the HTTP call succeeded, since under `tiered` mode a `skill_assignment`
proposal typically auto-applies immediately.

**Web client + hook** — `ApiClient.createSkillAssignmentProposal`
(`apps/web/src/lib/api/client.improvement-proposals.ts`) calls the
underlying axios client directly (bypassing the generic `ApiClient.post`
helper, which discards everything but `.data.data`) so the `outcome` field
survives, returning `{ outcome, proposal }`
(`CreateSkillAssignmentProposalResult`, `apps/web/src/lib/api/types.ts`).
`useCreateSkillAssignmentProposal`
(`apps/web/src/hooks/useImprovementProposals.ts`) wraps it in a TanStack
Query mutation that invalidates the proposals list query key on success.

**Dialog + wiring** — `AssignSkillDialog.tsx`
(`apps/web/src/pages/improvements/`) is a presentational form: a skill
picker (`useAgentSkills`), a target-type toggle (agent profile / workflow
step), the corresponding profile/workflow picker (`useAgentProfiles` /
`useWorkflows` — no new backend endpoints for picker data), a free-text
step-id field (there is no parsed-steps-list endpoint to pick from), and an
optional rationale textarea. It composes the request body and calls the
`onSubmit` prop the container supplies; the actual mutation call and its
`outcome` handling live in `ImprovementsQueue.tsx`, per the web quality
gate's side-effects-in-hooks rule. An "Assign skill" button opens the
dialog; on submit, `getAssignSkillOutcomeToast()`
(`assign-skill-outcome-toast.helpers.ts`) maps the returned `outcome` to a
toast (`auto_applied` → success, `proposed` → info, `dropped` → warning,
`apply_failed` → error) shown via the existing `useToast` hook.
`SkillBindingProvenance.tsx` additionally renders an "Operator-directed"
badge once binding provenance is available for a proposal whose
`provenance.source === 'ui_operator'`.

### Materialized skills join the DB corpus ("store-split")

Historically, a file-materialized skill (`skills/<name>/SKILL.md`) was
invisible to the retrospective router's `skillExists()` duplicate check,
which read a separate DB-backed `skills` corpus table used for retrieval.
`AgentSkillsService.upsertSkill()`
(`apps/api/src/ai-config/services/agent-skills.service.ts`) now
best-effort-syncs every file write into that corpus via
`SkillService.upsert()` (`source: 'agent_factory'`) — the file write remains
the source of truth; a corpus-sync failure is logged and swallowed, never
surfaces as an operation failure. This keeps `AgentSkillsService.skillExists()`
(file-based) and the corpus row eventually consistent enough that the
retrospective router stops proposing duplicate `skill_create`s for skills
that already exist on disk.

### `create_skill` capability now proposes self-assignment

`WorkflowRuntimeCapabilityLifecycleService.createSkill()` used to
self-assign a newly-created skill to the calling agent's profile directly.
It now builds a `skill_assignment` proposal draft
(`buildSkillAssignmentProposalDraft`, targeting `{ type: 'agent_profile',
profileName: callerProfileName }`) and submits it through
`ImprovementProposalService.submitProposal` — the same governed path
`suggest_skill_assignment` uses, so an agent can no longer silently grant
itself a skill outside governance. Skill materialization itself
(`AgentSkillsService.createSkill`) is unchanged and still synchronous.

## Service and REST API

`ImprovementProposalService` (`apps/api/src/improvement/improvement-proposal.service.ts`)
is the single entry point every producer (agent tool, learning-promotion
router, or a future producer) submits through:

- `submitProposal(draft)` — runs the draft through
  `ImprovementGovernancePolicyService`, then drops / creates as `pending` /
  auto-applies per the decision.
- `list(filter)`, `getById(id)`
- `findPendingSkillCreateByTargetName(name)` — dedup helper the
  `create_skill_proposal` agent tool uses before submitting a duplicate.
- `approve(id)`, `reject(id, reason?)`
- `bulkApprove(ids[])`, `bulkReject(ids[], reason?)` — both isolate
  per-id failures rather than failing the whole batch.
- `rollback(id)` — only from `status: 'applied'`; requires the resolved
  applier to implement `rollback()`.

Every mutating outcome emits an audit event (`improvement.proposal.dropped
| created | applied | failed | rejected | rolled_back`).

**Controller**: `apps/api/src/improvement/improvement-proposals.controller.ts`,
`@Controller('improvement/proposals')`, guarded by `JwtAuthGuard` +
`PermissionsGuard`:

| Method | Path                                 | Permission            |
| ------ | ------------------------------------ | --------------------- |
| GET    | `improvement/proposals`              | `improvements:read`   |
| GET    | `improvement/proposals/:id`          | `improvements:read`   |
| POST   | `improvement/proposals/:id/approve`  | `improvements:manage` |
| POST   | `improvement/proposals/:id/reject`   | `improvements:manage` |
| POST   | `improvement/proposals/bulk-approve` | `improvements:manage` |
| POST   | `improvement/proposals/bulk-reject`  | `improvements:manage` |
| POST   | `improvement/proposals/:id/rollback` | `improvements:manage` |

Note the singular `reject` route takes no body; only `bulk-reject` accepts
an optional `reason`. `improvements:read`/`improvements:manage` are
registered permission strings in the authorization permission catalog —
role-to-permission grants for them are not yet seeded as part of Epic A and
should be added before relying on non-admin access in an environment with
fine-grained roles.

`ImprovementModule` imports `AiConfigModule`, `AuthModule`,
`AuthorizationModule`, `ConfigResolutionModule` (Epic D, for
`WorkflowDefinitionChangeApplier`'s optional `ConfigResolutionCache`
invalidation), `DatabaseModule`, `ObservabilityModule`,
`SystemSettingsModule`, `WorkflowSkillBindingsModule`, and
`forwardRef(() => WorkflowCoreModule)` (the `forwardRef` breaks a
module-graph cycle that runs through `WorkflowRetrospectiveModule`). It
declares the controller, provides `ImprovementProposalService`,
`ImprovementGovernancePolicyService`, `ImprovementApplierRegistry`,
`SkillCreateApplier`, `AgentProfileChangeApplier` (Epic D),
`WorkflowDefinitionChangeApplier` (Epic D), and
`SkillCreateCompletionListener`, and exports only
`ImprovementProposalService` — `ImprovementProposalRepository` is supplied
by the shared `DatabaseModule` TypeORM feature registration, not locally
provided. (Epic B) `SkillAssignmentApplier` is registered via a
`useFactory` provider (its `skills`/`bindings` constructor params are
narrow structural gateway types adapted from
`AgentSkillsService`/`WorkflowSkillBindingService`, not plain constructor
DI), and the `IMPROVEMENT_APPLIERS` factory now injects all four appliers
(`SkillCreateApplier`, `SkillAssignmentApplier`, `AgentProfileChangeApplier`,
`WorkflowDefinitionChangeApplier`).

## Web: the Improvements queue

`apps/web/src/pages/improvements/ImprovementsQueue.tsx`, routed at
`/improvements` (registered in `apps/web/src/App.tsx`, with an "Improvements"
entry in the main navigation config) renders a filterable, selectable table
(Kind / Status / Confidence / Created / Actions) backed by the
`useImprovementProposals()` hook. The filter bar offers Kind/Status
multiselects plus bulk Approve/Reject buttons (enabled once rows are
checked); each row has per-row Approve/Reject buttons (only active while
`status === 'pending'`) and an expandable detail panel
(`ImprovementProposalRow.tsx`). The hook also exposes a `rollback` mutation
that is not yet wired into a UI control.

As of Epic B, `skill_create` and `skill_assignment` rows get a dedicated
detail view instead of the raw-JSON stub — `SkillProposalDetail.tsx`
(`apps/web/src/pages/improvements/`), fed by the
`getSkillProposalDetailData()` view-model helper
(`skill-proposal-detail.helpers.ts`). It shows the target skill name, (for
`skill_create`) the proposal summary and a patch-markdown preview, the
requested `assignment_targets` (`SkillAssignmentTargetList.tsx`), and —
when binding provenance is present on `rollback_data`/`provenance` —
`SkillBindingProvenance.tsx`, a two-section view of which targets were
actually applied vs. left `unrouted` (with the reason). As of Epic D,
`agent_profile_change` and `workflow_definition_change` rows also get
dedicated detail views (`AgentProfileChangeDetail.tsx` /
`WorkflowDefinitionChangeDetail.tsx` — see
[Definition-Change Proposals](#definition-change-proposals-epic-d) below).
Only `code_change` still falls back to the raw `{kind, payload}` JSON stub,
pending Epic E.

### Legacy skill-proposal queue retired

The old skill-proposal-specific REST surface and its Learning-tab embedded
proposal UI are **deleted**, not deprecated (see commit `75a843ba7`):
`SkillProposalService`, `SkillProposalsController`,
`SkillProposalApprovedListener`, `SkillProposalCompletionListener`, the
`skill-improvement-proposal` entity/repository, and their specs are all
gone, along with the `/skills/proposals*` routes and the
`skill_improvement_proposals` table (dropped by the migration above).
`apps/web/src/pages/project-workspace/LearningTab.tsx` no longer embeds a
proposal table — `LearningTabProposalsPointerCard.tsx` replaces it with a
plain pointer card ("Proposals generated by learning sweeps are reviewed in
the global Improvements queue, alongside proposals from every project")
linking to `/improvements`. Skill scope-confirmation review UI (the old
Scope Confirmation Card — reviewing/adjusting a **newly-created** skill's
recommended visibility scope) is **not** part of the unified queue —
today, scope is either left `manual` (skill lands unscoped, no confirmation
step surfaced) or auto-applied by `SkillCreateCompletionListener` when
`skill_scope_confirmation_mode='auto'`; that specific gap remains deferred
(no epic currently owns it). What the deleted `/skills/:name/confirm-scope`
flow's _human-facing "do something about a skill" surface_ is replaced by
is the FU-10/PD-4 **"Assign skill" action** (below) — a first-class,
operator-initiated way to bind an **existing** skill to an agent profile or
workflow/step, landed directly in the Improvements queue rather than a
Learning-tab card. It solves a related but distinct problem (assigning a
skill to a target) than scope confirmation (setting a skill's own
visibility), so it is not a literal replacement of the old card — see
[Human-Facing Assign Skill Flow](#human-facing-assign-skill-flow-fu-10pd-4)
below.

### Producers now feeding the unified pipeline

- The `create_skill_proposal` agent tool (still registered, same tool name)
  now dedups via `findPendingSkillCreateByTargetName` and submits through
  `ImprovementProposalService.submitProposal` — i.e. it is **governed** by
  the policy above, unlike before.
- `LearningPromotionService`'s skill-routing path
  (`learning-promotion.dispatch.ts` → `handleSkillProposal()`) writes
  `kind: 'skill_create'` rows directly via the `ImprovementProposalRepository`
  (bypassing `submitProposal`/governance), because
  `PromotionGovernancePolicyService` already gated the routing decision
  upstream in `dispatchByRoute`. Both paths land in the same
  `improvement_proposals` table.
- (Epic B) `RetrospectiveOutputRouter.routeSkillProposal()` — emits
  `skill_create` or `skill_assignment` depending on whether the target skill
  name already exists (see [Skill Assignment](#skill-assignment-epic-b)).
- (Epic B) The `suggest_skill_assignment` agent tool and the `create_skill`
  runtime capability's self-assignment step both submit `skill_assignment`
  proposals through `submitProposal` — fully governed, never applied
  directly.
- (FU-10/PD-4) `POST /improvement/proposals` — the human-operator "Assign
  skill" flow in the web Improvements queue — submits a `skill_assignment`
  proposal the same way, tagged `provenance.source: 'ui_operator'`. See
  [Human-Facing Assign Skill Flow](#human-facing-assign-skill-flow-fu-10pd-4)
  below.
- (Epic D) `RetrospectiveOutputRouter.routeAgentProfileChange()` /
  `.routeWorkflowDefinitionChange()` emit `agent_profile_change` /
  `workflow_definition_change` proposals from the same retrospective analyst
  pipeline — see [Definition-Change Proposals](#definition-change-proposals-epic-d)
  below.

## Definition-Change Proposals (Epic D)

Epic D adds the two remaining proposal kinds that mutate a **live
definition row** rather than materializing or binding a skill: an existing
agent profile's fields (`agent_profile_change`) or an existing workflow's
YAML (`workflow_definition_change`). Both are structurally riskier than the
Epic A/B kinds — a bad apply can break every future run of the mutated
profile or workflow — so Epic D leans harder on pre-apply validation, a
write-once rollback snapshot, reseed protection, and a tighter governance
posture than the rest of the pipeline.

### The two payload shapes

Defined in `packages/core/src/improvement/definition-change-payloads.schema.ts`:

```ts
// agent_profile_change
{
  profileName: string;
  patch: {
    system_prompt?: { mode: "append" | "replace"; value: string };
    model_name?: string;
    provider_name?: string;
    thinking_level?: RunnerThinkingLevel | null;
    tool_policy?: AgentProfileToolPolicy;
    assigned_skills?: { add?: string[]; remove?: string[] };
  }; // at least one field required
  changeSummary: string;
}

// workflow_definition_change
{
  workflowName?: string;      // workflowName or workflowId required
  workflowId?: string;        // uuid
  proposedYaml: string;       // the FULL corrected yaml_definition, never a fragment
  changeSummary: WorkflowChangeSummaryEntry[]; // [{ stepId?, field, from, to, rationale }], min 1
}
```

`model_name`/`provider_name` are deliberately **not** nullable on the patch —
`UpdateAgentProfileSchema` (the apply path, see below) has no way to clear
either field to `null`, so the patch contract never promises a capability
the applier cannot deliver.

### Appliers: validate → snapshot → mutate

**`AgentProfileChangeApplier`** (`apps/api/src/improvement/appliers/agent-profile-change.applier.ts`,
`kind: 'agent_profile_change'`) looks up the target profile by name
(`AgentProfileRepository.findByName`); a missing profile fails with
`unrouted: true` rather than silently no-op-ing. It then reuses
`AiConfigAdminService.updateAgentProfile` — the **same path the admin UI's
human edits take**, including its IAM-policy refresh — for the
prompt/model/provider/thinking-level/tool-policy fields, and
`AgentSkillsService.addProfileSkills`/`removeProfileSkills` for the
`assigned_skills` add/remove lists. It does not reimplement profile
persistence.

**`WorkflowDefinitionChangeApplier`** (`apps/api/src/improvement/appliers/workflow-definition-change.applier.ts`,
`kind: 'workflow_definition_change'`) resolves the target workflow by id or
name (including inactive workflows), then **pre-validates the proposed YAML
before touching anything**: `WorkflowParserService.parseWorkflow()` →
`WorkflowValidationService.validateWorkflow()` → a guard that the parsed
definition's `name` matches the target workflow's current name (a proposal
can change a workflow's _content_, never rename it). Only once all three
pass does it call `IWorkflowPersistenceService.updateWorkflow()` — the same
path the admin UI's human workflow edits take, including its security scan
and GitOps edit-policy check.

**Apply order is load-bearing for both appliers** (see each `apply()`):

1. Validate the payload and resolve the target row — a bad proposal fails
   cleanly here, before anything is written.
2. Persist the pre-mutation **rollback snapshot** (`persistRollbackSnapshotOnce`,
   `apps/api/src/improvement/appliers/definition-change.helpers.ts`) — write
   **once**: if `proposal.rollback_data` is already non-null (e.g. a retry
   after a mid-apply crash), the helper is a no-op, so a retry can never
   overwrite the true pre-mutation state with an already-partially-mutated
   one.
3. Stamp the row's `overrides` jsonb with a reseed-protection marker
   (`buildImprovementOverridesMarker`, same helper module) — **before** the
   actual field mutation.
4. Only then perform the real mutation (`updateAgentProfile` /
   `updateWorkflow`).

This ordering means a crash mid-apply always leaves the row in one of two
safe states — untouched-and-unpinned (steps 1 failed) or
pinned-but-not-yet-fully-changed (steps 2–3 succeeded, step 4 didn't) —
**never** an applied-but-unpinned change a reseed could silently clobber.

**`ImprovementProposalService.applyProposal` auto-rolls-back a
pinned-but-not-yet-fully-changed row.** If `apply()` returns `{ok:false}` or
throws — e.g. step 4 above never ran — the private `rollbackAfterApplyFailure`
helper invokes the resolved applier's `rollback()` **before** the proposal is
marked `failed`, so the row is restored to its true pre-mutation snapshot and
the `overrides` marker is cleared rather than left orphaned on an unchanged
definition. It fires only when it is actually meaningful, guarded two ways:

1. `typeof applier.rollback === 'function'` — not every applier kind
   implements rollback (`skill_create`, `skill_assignment`, `code_change` do
   not), so those are left untouched.
2. A snapshot must actually exist. Many `apply()` failures are _pre-mutation_
   (invalid payload, target not found, YAML parse/validation, name mismatch —
   steps 1 above) and return `{ok:false}` before `persistRollbackSnapshotOnce`
   ever runs, leaving `rollback_data` null. The helper re-reads the
   authoritative proposal and skips rollback when `rollback_data` is null —
   the same source `rollback()` itself reads, so the guard and the rollback
   agree — avoiding a spurious "nothing to restore" throw/warn on these common
   pre-mutation failures.

It is best-effort and never allowed to mask the original apply failure: a
`rollback()` throw is caught, logged, and the proposal is still marked
`failed` with the original apply error in `provenance.apply_error`. This
makes the failure path symmetric with the explicit `rollback(id)` API below,
which restores the same snapshot on user request.

`rollback()` on both appliers restores the persisted snapshot verbatim
(`AgentProfileChangeApplier` splits the snapshot into
`AiConfigAdminService`-routed fields vs. raw repository fields;
`WorkflowDefinitionChangeApplier` restores `yaml_definition` + `overrides`
directly) and throws — rather than silently no-op-ing — if `rollback_data`
is absent or malformed, since there is nothing safe to restore to.

### Reseed protection: the `overrides` marker

`buildImprovementOverridesMarker(existing, proposalId, appliedAtIso)`
merges `{ improvement_proposal: { proposal_id, applied_at } }` into the
row's existing `overrides` jsonb (key `IMPROVEMENT_OVERRIDES_KEY =
'improvement_proposal'`). Both reseed guards —
`AgentProfileSeedService.shouldSkipReseed` and
`WorkflowSeedService.updateExistingWorkflowIfNeeded` — skip reseeding **any**
row with a non-null `overrides` value, so this marker alone is the entire
protection: once a definition-change proposal applies, the standard
seed-on-boot path will never silently revert it back to the YAML-authored
baseline.

### Governance posture: pinned, never auto-applies below the autonomous floor

`decideGovernanceAction` (`apps/api/src/improvement/governance/improvement-governance-policy.helpers.ts`)
is the same generic decision function every proposal kind goes through —
Epic D pins the posture for these two kinds by what it does **not** do:
neither `agent_profile_change` nor `workflow_definition_change` is in the
tiered auto-apply allowlist (`TIERED_AUTO_APPLY_KINDS`, currently only
`skill_assignment`), so in `tiered` mode they **always** propose regardless
of confidence or evidence class. In `autonomous` mode they fall through to
the same generic rule as everything else — auto-apply once capped
confidence is `>= 0.5` — but because the `inference` evidence-class cap
(`0.45`) is mathematically below that floor, an inference-evidenced
definition-change proposal can **never** auto-apply; only a
`struggle_backed` finding (capped at `0.7`) can clear the bar. Net effect,
pinned by `definition-change-governance.spec.ts`:

| Mode         | struggle_backed (0.7 capped) | inference (0.45 capped) |
| ------------ | ---------------------------- | ----------------------- |
| `manual`     | propose                      | propose                 |
| `tiered`     | propose                      | propose                 |
| `autonomous` | **auto_apply** (≥ 0.5 floor) | propose (0.45 < 0.5)    |

In short: a definition change never auto-applies in `tiered` or `manual`
mode, and even in `autonomous` mode it needs struggle-backed evidence, not
mere inference.

### Retrospective analyst: context + routing + anti-hallucination gate

The EPIC-212 retrospective analyst (see
[35 — Memory & Learning Systems](35-memory-learning.md)) can now emit
`agent_profile_change` / `workflow_definition_change` findings alongside its
existing `memory` / `skill_proposal` / `none` kinds. Because the analyst
only ever sees a **digest** of a run (not full profile/workflow definitions,
and definitely not authority to invent identifiers), two pieces of ground
truth are threaded through the retrospective trigger context so it never has
to guess a `profileName` or workflow YAML baseline:

- **`workflow_yaml`** — the target run's workflow's _current, complete_
  `yaml_definition`, resolved fail-soft by
  `RetrospectiveAnalysisService` (`retrospective-workflow-yaml.helpers.ts`;
  omitted entirely if the lookup fails). This is the only input the analyst
  may propose a `workflow_definition_change` against.
- **`acting_agent_profiles`** — the agent profile(s) that _actually executed
  steps in the run_ (ground truth, not a guess): an array of
  `{profileName, systemPrompt, modelName, providerName, thinkingLevel,
toolPolicy, assignedSkills}`, resolved by
  `retrospective-acting-agent-profiles.helpers.ts` from each
  step/subagent's `chat_sessions` row, **and** (added in a follow-up fix)
  the run's `executions.agent_profile_id`/`agent_profile_name` columns as a
  fallback source — `chat_sessions` rows only exist for runs that spawned a
  subagent, so the fallback is what makes the gate usable for the common
  single-agent-per-step run. `executions.agent_profile_name`/`agent_profile_id`
  are now populated at step dispatch via the existing `persistResolvedConfig`
  seam, once the profile is resolved.

`seed/workflows/prompts/run-retrospective/analyze.md` documents both new
finding kinds and their exact `profile_change`/`workflow_change` payload
shapes, and enforces an explicit **anti-hallucination gate** as a hard rule:
an `agent_profile_change` finding's `profileName` must be copied **verbatim**
from an entry in `acting_agent_profiles` — never a name merely mentioned in
the digest's prose — and the analyst must not emit `agent_profile_change` at
all if `acting_agent_profiles` is empty or absent (falling back to `memory`
or `none` instead); symmetrically, `workflow_definition_change` may only be
proposed when `workflow_yaml` was supplied, and `proposedYaml` must be the
full corrected definition, never a fragment.

`RetrospectiveOutputRouter.routeAgentProfileChange()` /
`.routeWorkflowDefinitionChange()`
(`apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.ts`)
add a second, server-side layer of defense on top of the prompt-level gate:
each re-validates the finding's `profile_change`/`workflow_change` payload
against the Epic D schemas and confirms the target profile/workflow **still
exists** (by name for profiles; by id-or-name, inactive included, for
workflows — the same identifier resolution `WorkflowDefinitionChangeApplier`
uses at apply time) before calling `submitProposal`. A hallucinated or
stale identifier is dropped with an honest `target_not_found` reason code
rather than ever reaching `ImprovementProposalService` or an applier.
Governance (auto-apply vs. propose vs. drop) is entirely `submitProposal`'s
job — the router only gates on payload shape and target existence.

`WorkflowRetrospectiveModule` gained a `forwardRef(() =>
ExecutionLifecycleModule)` edge to reach the execution row that now carries
`agent_profile_id`/`agent_profile_name`; this closes a pre-existing module
cycle (`SessionModule → MemoryModule → ... → WorkflowStepExecutionModule →
ExecutionLifecycleModule`, already documented in
`apps/api/CIRCULAR_BASELINE.md`) rather than introducing a new one, and is
covered by `app-module-boot.integration.spec.ts` (the full-DI-graph boot
gate).

### Web: patch diff, YAML diff, and rollback

The Improvements queue (`ImprovementsQueue.tsx`) routes both kinds to
dedicated detail components instead of the raw-JSON stub:

- **`AgentProfileChangeDetail.tsx`** (`apps/web/src/pages/improvements/`) —
  shows the target profile name, the human-authored `changeSummary`, and a
  field-by-field patch table (`formatProfilePatchEntries`,
  `improvements-detail.helpers.ts`) with `from`/`to` columns per changed
  field (`from` sourced from the persisted `rollback_data` snapshot once
  applied).
- **`WorkflowDefinitionChangeDetail.tsx`** — shows the target workflow name,
  a `changeSummary` table (step / field / from / to / rationale), and a
  side-by-side YAML diff using `@monaco-editor/react`'s `DiffEditor`
  (read-only, `language: 'yaml'`). The diff's `original` side comes from
  `useWorkflowYamlForDiff()` (`apps/web/src/hooks/useImprovementProposalDetail.ts`),
  which resolves the pre-apply baseline from `rollback_data.yaml_definition`
  if present, else fetches the workflow by `payload.workflowId`, else
  renders a plain preview of the proposed YAML with an explanatory note
  when no baseline is resolvable at all (e.g. still `pending`).
- **`ProposalRollbackButton.tsx`** — shared by both detail views (and
  hosted inside each, next to the target identifier), calls the
  `rollback` mutation already exposed by `useImprovementProposals()`
  (shipped in Epic A) and is only rendered/enabled for proposals with
  `status: 'applied'`.

## Deployment notes

- The migration above **backfills and drops** `skill_improvement_proposals`
  on boot — this is a one-way migration, so any environment with pending
  legacy proposals should let the backfill run before assuming they are
  gone.
- New system-setting defaults (`improvement_governance_mode`,
  `improvement_governance_overrides`, plus the reused
  `retrospective_confidence_struggle_cap`/`retrospective_confidence_inference_cap`
  pair) seed on boot via the standard `SYSTEM_SETTING_DEFAULTS` seeding path
  — no manual seed step required.
- (Epic B) `20260714000000-create-workflow-skill-bindings.ts` creates the
  `workflow_skill_bindings` table — also runs at API boot, no manual step.
- Both migrations require a `nexus-api` image rebuild + redeploy to take
  effect in a running stack (migrations run at API boot; settings seed at
  API boot).
- (Epic D) No new migration — `executions.agent_profile_id`/`agent_profile_name`
  already existed (added by `20260621000000-add-execution-resolved-config.ts`);
  Epic D only starts populating them at step dispatch. A live stack does
  need a **reseed** of `run-retrospective.workflow.yaml` and
  `seed/workflows/prompts/run-retrospective/analyze.md` for the analyst to
  receive the new `workflow_yaml`/`acting_agent_profiles` trigger inputs and
  the updated prompt instructions — without the reseed, the analyst has no
  way to emit `agent_profile_change`/`workflow_definition_change` findings
  even though the router/applier side is already deployed.
- (Epic D) Definition-change governance reuses the existing
  `improvement_governance_mode`/`improvement_governance_overrides` and
  `retrospective_confidence_struggle_cap`/`retrospective_confidence_inference_cap`
  settings — no new settings to seed.

## Code-Change Bridge (Epic E)

Epic E adds the last proposal kind, `code_change`: a structured engineering
brief describing a bug or gap the system found in itself, destined to become
a **work item in a code repo** rather than a local mutation the API can apply
by itself. Because "create a work item" is a Kanban-domain operation and
`apps/api`/`packages/core` must stay Kanban-neutral (see
[Core/Kanban Boundary](../../AGENTS.md#core-kanban-boundary)), the applier
never talks to Kanban directly — it publishes a **neutral** event onto the
shared Redis lifecycle stream, and a Kanban-side consumer decides what to do
with it. This mirrors the same neutral-event pattern the pre-existing
`core.integration.pr_merged.v1`/`core.integration.pr_status.v1` events use.

### Payload shape

`CodeChangeProposalPayloadSchema`
(`packages/core/src/improvement/code-change.schema.ts`):

```ts
{
  title: string;
  description: string;
  suspectedArea?: string[];
  evidence: { runIds: string[]; failureClasses: string[]; ledgerRefs: string[] };
  severity: "low" | "medium" | "high" | "critical";
}
```

### Intake dedup (before a row is ever created)

`CodeChangeProposalIntakeService`
(`apps/api/src/improvement/code-change-proposal-intake.service.ts`) is the
**single mandatory entry point** for every `code_change` producer — it must
not be bypassed by calling `ImprovementProposalService.submitProposal`
directly for this kind. It runs `CodeChangeDedupService.findDuplicate()`
first: if a `pending` or `applied` `code_change` proposal from the last 30
days has the **exact same normalized title**
(`normalizeCodeChangeTitle` — case/whitespace/punctuation-insensitive exact
match, not fuzzy similarity), the existing row's `occurrence_count` is bumped
instead of creating a duplicate. Only a genuinely new title reaches
`submitProposal` (and therefore the governance policy below). An
embedding/lexical-similarity dedup tier was deliberately left out — see the
doc comment on `CodeChangeDedupService` for why the shared
`EmbeddingSimilarityService`'s RRF-fused score is structurally incompatible
with the existing similarity threshold, making that tier decorative rather
than functional until the shared service's threshold semantics are fixed.

### Governance posture

`code_change` is **not** in the tiered auto-apply allowlist (only
`skill_assignment` is), so in `tiered` (default) or `manual` mode every
`code_change` proposal always `propose`s — a human approves it from the
Improvements queue before it applies. Only in `autonomous` mode can a
sufficiently-confident proposal (`>= 0.5` capped confidence) auto-apply. See
[Governance posture](../operations/self-improvement-project.md#governance-posture-propose-vs-auto_apply)
in the operations runbook for the full mode/evidence-class table.

### `CodeChangeApplier`: publish, don't reach into Kanban

`CodeChangeApplier` (`apps/api/src/improvement/appliers/code-change.applier.ts`,
`kind: 'code_change'`) is the only applier with no local mutation and no
`rollback()` — its `apply()` builds and validates an
`ImprovementTaskRequestedEventEnvelopeV1` (`packages/core/src/schemas/events/event-envelope.schema.ts`)
carrying `proposalId`, `title`, `description`, `suspectedArea`, `evidence`,
`severity`, and `occurrenceCount`, then publishes it via
`ImprovementTaskEventPublisher` onto `stream:core:lifecycle`
(`event_type: 'improvement.task.requested.v1'`, `source_service: 'core'`). A
successful `apply()` means only "the brief was published" — delivery is
asynchronous and the applier never learns (or asks) whether a downstream
domain routed it anywhere, so `unrouted` is never set here. A malformed
stored payload or a publish failure degrades to `{ ok: false }` rather than
throwing, so a bad row surfaces as a normal `failed` proposal instead of an
unhandled exception. Re-`apply`ing (e.g. a retry) republishes the same
`proposalId`, which the Kanban-side consumer treats idempotently (below), so
the applier is safe to retry end-to-end.

### Kanban side: consume → file a work item, or park

On the Kanban side, `CoreLifecycleStreamConsumerService` polls
`stream:core:lifecycle` and routes `improvement.task.requested.v1` entries to
`CoreLifecycleStreamImprovementTaskHandler`
(`apps/kanban/src/core/core-lifecycle-stream-improvement-task.handler.ts`):

- **Configured** (`self_improvement_project_id` Kanban setting is set) — the
  handler checks for an existing work item first (**the work-item id is the
  proposal id**, so redelivery — e.g. after a manual replay — never files a
  duplicate) and otherwise creates one on that project's backlog, carrying
  `severity`/`occurrenceCount`/`suspectedArea`/`evidence` in
  `metadata.improvement`. From there it rides the normal
  dispatch → implement → quality-gate → auto-merge pipeline like any other
  work item.
- **Unconfigured** (default, empty string) — the handler throws
  `ImprovementTaskParkedError` rather than silently dropping the brief. The
  consumer's per-entry `try/catch` dead-letters the raw stream entry to
  `kanban_core_lifecycle_dead_letters` and still advances the stream cursor
  past it (so one parked entry never stalls subsequent ones). The originating
  API-side proposal is unaffected — it is already `applied`; there is nothing
  to re-approve, since delivery routing is entirely a downstream (Kanban)
  concern the API never tracks.

Full setup, the parking/dead-letter mechanics, manual replay of a parked
entry, and live verification steps are in the operations runbook:
[`docs/operations/self-improvement-project.md`](../operations/self-improvement-project.md).

### Web: code_change proposal detail

`ImprovementCodeChangeDetail.tsx`
(`apps/web/src/pages/improvements/`) replaces the raw-JSON stub for this kind
— the last one to get a dedicated detail view, closing out the queue's
kind coverage (`skill_create`/`skill_assignment` from Epic B,
`agent_profile_change`/`workflow_definition_change` from Epic D). It renders
the brief's title/description/severity badge, an occurrence-count badge when
`occurrenceCount > 1` (visible evidence the intake dedup above is bumping
recurring briefs instead of spamming the queue), the suspected source areas,
and the evidence list (run ids, failure classes, ledger refs).

### `apps/repair-agent` deleted

The standalone `apps/repair-agent` service (a separate WebSocket-listener
process for autonomous repair, port `8765`) is deleted outright — directory,
`docker-compose` service definition, telemetry-repair integration wiring, and
every living reference — rather than deprecated alongside it. Its
functionality is superseded by this pipeline: a self-detected issue now
becomes a governed `code_change` proposal that a human (or, in `autonomous`
mode, the governance floor) approves into a normal work item, going through
the same build/lint/test/quality-gate/auto-merge pipeline as any other
change, instead of a separate out-of-band repair process.

### E2E note: how the bridge is tested / exercised end-to-end

The API and Kanban sides of this bridge are two separate deployables with
separate databases connected only by the Redis stream, so there is no single
automated test that drives a real `code_change` proposal through a live
Redis stream into a live Kanban database. Coverage is layered instead:

- **Schema/contract pin** — `event-envelope.improvement-task.spec.ts`
  (`packages/core`) pins the `ImprovementTaskRequestedEventEnvelopeV1Schema`
  shape both sides agree on.
- **API side (unit)** — `code-change.applier.spec.ts` covers publish
  success, invalid-payload degrade-to-`ok:false`, and publish-failure
  degrade-to-`ok:false`; `improvement-task-event.publisher.spec.ts` covers
  the Redis `XADD` call shape; `code-change-dedup.service.spec.ts` /
  `code-change-proposal-intake.service.spec.ts` cover the exact-title dedup
  and occurrence-bump path.
- **Kanban side (unit)** — `core-lifecycle-stream-improvement-task.handler.spec.ts`
  covers all three handler outcomes (creates a work item; parks with
  `ImprovementTaskParkedError` when unconfigured; skips when a work item for
  the proposal id already exists); `core-lifecycle-stream-improvement-task.helpers.spec.ts`
  covers the description/priority-mapping pure helpers.
- **Live/manual E2E** — the operations runbook's
  [Verification](../operations/self-improvement-project.md#verification)
  section is the closest thing to an end-to-end drive of the real path:
  configure `self_improvement_project_id`, approve a `code_change` proposal
  from the Improvements queue, confirm the `improvement.task.requested.v1`
  entry lands on `stream:core:lifecycle` via `redis-cli XREVRANGE`, and
  confirm the work item appears on the configured project's board with
  `metadata.improvement.proposalId` set. This is the recommended path to
  exercise the bridge for real against a running stack.

Note: `apps/kanban/test/split-service/self-improvement-loop.integration-spec.ts`
is a **different**, pre-existing self-improvement loop (workflow failure →
runtime-feedback → `learning_candidates` → memory-segment promotion →
auto-injection — the memory/learning loop documented in
[35 — Memory & Learning Systems](35-memory-learning.md)), not the Epic E
code-change bridge — despite the similar name, it exercises no `code_change`
proposal or lifecycle-stream event at all.

## Cross-references

- [35 — Memory & Learning Systems](35-memory-learning.md) — the learning
  pipeline that feeds `skill_create` proposals into this pipeline via
  `LearningPromotionService`
- [06 — Workflow Engine](06-workflow-engine.md#skill-assignment-skills-yaml-surface) —
  the author-time `skills:` YAML surface (workflow + step level), distinct
  from the runtime `workflow_skill_bindings` this pipeline writes
- [09 — Workflow Subagents](09-workflow-subagents.md) — the subagent skill
  resolution path that now shares `resolveAgentAssignedSkills` with the step
  executor
- [35 — Memory & Learning Systems](35-memory-learning.md#retrospective-analyst-loop-epic-212-phase-2) —
  the EPIC-212 retrospective analyst pipeline that produces
  `agent_profile_change`/`workflow_definition_change` findings (Epic D)
- [06 — Workflow Engine](06-workflow-engine.md) — `WorkflowParserService` /
  `WorkflowValidationService` / `IWorkflowPersistenceService`, reused as-is by
  `WorkflowDefinitionChangeApplier` (Epic D)
- [`docs/operations/self-improvement-project.md`](../operations/self-improvement-project.md) —
  the code-change bridge operations runbook: project setup, setting
  configuration, parking/dead-letter recovery, and live verification (Epic E)
- [Glossary](34-glossary.md)
