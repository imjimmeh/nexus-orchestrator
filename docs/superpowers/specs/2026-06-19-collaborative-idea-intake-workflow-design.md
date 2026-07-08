# Collaborative Idea Intake Workflow — Design

- **Date:** 2026-06-19
- **Status:** Approved (pending implementation plan)
- **Owner:** Jimmeh

## Context

Users frequently arrive at a kanban project with a rough idea for work that is not
yet shaped into concrete tasks. Today there is no guided way to take that nascent
idea, talk it through with an agent, and land it on the board. The CEO orchestration
and goal-backlog workflows ideate _autonomously_ from persisted project state; they
do not collaborate with a human in real time on a fresh idea.

This workflow fills that gap: a **manually-launched, project-scoped** conversation
where the user and an agent ideate together, refine the idea just enough to be
actionable, and capture the result as a kanban **initiative** plus a set of
lightweight **backlog work items** linked to it.

The work items are intentionally _un-refined_. Deepening, splitting, and spec
hydration are already owned by the kanban refinement lifecycle
(`work_item_refinement_default` et al.). This workflow's job is to help the user get
their thoughts onto "paper" as board records — not to produce finished specs.

## Goals

- Let a user trigger an ideation session manually from a project page.
- Drive a real, multi-turn conversation that helps the user narrow and refine an idea.
- Persist the refined idea as a kanban **initiative**.
- Create lightweight **backlog** work items linked to that initiative, only after the
  user explicitly confirms the list.

## Non-Goals

- Producing refined or fully-specified work items (the refinement lifecycle does that).
- Autonomous ideation without a human in the loop.
- Any code, repo, or filesystem mutation — this workflow only talks and writes kanban records.
- Reusing or broadening the shared `product-manager` profile.

## Decisions

These were resolved during brainstorming:

1. **Creation flow:** the conversational agent creates work items **inline, after
   explicit confirmation** (not via a deferred batch job).
2. **Idea artifact:** the refined idea is persisted as a **kanban initiative**; every
   created work item is linked to it. (Not a standalone artifact doc.)
3. **Agent profile:** a **new dedicated profile** (`idea-partner`), leaving
   `product-manager` untouched. This was chosen over reusing `product-manager`
   because reuse would require broadening a shared profile globally — see Constraints.
4. **Job structure:** a **single inline conversational job**, not the split
   propose-then-deterministic-create pattern used by `project_goal_backlog_planning`.
   The dedicated profile permits direct creation, so keeping it inline lets the agent
   confirm-then-create within one conversation and report exact results back.
5. **Assigned skill:** reuse the existing `product-requirements-refinement` skill;
   no new skill seed.

## Constraints / Key Mechanics

- **Profile ceiling (critical).** The runtime resolves a step's callable tools as
  `jobScoped ∩ profileAllowed`
  (`apps/api/src/workflow/workflow-step-execution/step-support-tool-policy.helpers.ts`,
  final intersection at the end of `resolveAllowedToolNamesForStep`). Workflow- and
  job-level `allow` rules can only **narrow**, never broaden past the agent profile.
  Therefore every tool the conversation needs must be allowed by **both** the
  `idea-partner` profile **and** the workflow/job policy.

  The existing `product-manager` profile is missing `ask_user_questions`,
  `kanban.work_item_create` (it has `propose_work_items`), and
  `kanban.initiative_link_work_item` (it has `initiative_link_goal`). That is the
  concrete reason a dedicated profile is required for inline creation.

- **Seed-data validation.** `computeEffectiveCallableTools`
  (`apps/api/src/database/seeds/seed-data-validation.effective-access.helpers.ts`)
  asserts that every tool referenced by a prompt is within the agent's effective
  access. The design keeps prompt-referenced tools ⊆ (profile ∩ workflow ∩ job).

- **Manual project-page launch.** A workflow with `trigger.type: manual` and
  `launch.context: scope` surfaces as a launchable action on the project page
  (same mechanism as `project_goal_backlog_planning`). The launch supplies `scopeId`
  as the project context.

- **Durable conversation delivery.** `ask_user_questions` parks the run until the
  launching user answers in the UI, then resumes — the supported multi-turn pattern
  (as used by `chat_direct_agent_default`).

## Architecture

### New seed artifacts

| Artifact      | Path                                                   | Notes                              |
| ------------- | ------------------------------------------------------ | ---------------------------------- |
| Workflow      | `seed/workflows/project-idea-intake.workflow.yaml`     | `workflow_id: project_idea_intake` |
| Agent profile | `seed/agents/idea-partner/agent.json`                  | dedicated, tier `heavy`            |
| Prompt        | `seed/workflows/prompts/project-idea-intake/ideate.md` | conversational driver              |

### Agent profile: `idea-partner`

Default-deny `tool_policy` allowing exactly:

- `ask_user_questions` — the conversation engine
- `read`, `ls`, `search_skills`, `query_memory`, `get_todo_list`, `manage_todo_list`
- `kanban.project_state`, `kanban.get_charter` — ground the conversation in the real project
- `kanban.initiative_create`, `kanban.initiative_link_work_item`
- `kanban.work_item_create`
- `set_job_output`, `step_complete`

`tier_preference: heavy`. `assigned_skills: [product-requirements-refinement]`.
`is_active: true`. No `write` / `edit` / `bash`.

### Workflow: `project_idea_intake`

```
trigger:
  type: manual
  launch:
    context: scope
    inputs:
      - scopeId   (string, required)  — project id (supplied by project-page context)
      - ideaSeed  (string, optional)  — the user's starting thought
concurrency: { max_runs: 1, scope: trigger.scopeId, on_conflict: queue }
permissions.tool_policy: default deny + allow the idea-partner tool surface
```

**Single job `ideate_and_capture`** — `type: execution`, `tier: heavy`,
`agent_profile: idea-partner`, job-level default-deny policy granting the same tool
surface, `prompt_file: prompts/project-idea-intake/ideate.md`.

`output_contract.required: [initiative_id, created_work_item_ids, session_summary]`
(types: `initiative_id: string`, `created_work_item_ids: array<string>`,
`session_summary: string`).

### Conversation flow (prompt responsibilities)

1. **Ground** — call `kanban.project_state` (and `kanban.get_charter` when useful) to
   understand the project before talking.
2. **Open** — greet; if `ideaSeed` is present, reflect it back; otherwise open with
   `ask_user_questions` asking what the idea is.
3. **Ideate & refine** — loop on `ask_user_questions` to narrow the idea: the problem,
   the value/outcome, and a rough shape of the work. Keep it light; do not over-plan.
4. **Confirm** — propose an initiative (title + description capturing the refined idea)
   and a short candidate list of work items; use `ask_user_questions` to get explicit
   confirmation (and allow the user to tweak the list) **before creating anything**.
5. **Capture** — on confirmation:
   - `kanban.initiative_create` (capture `initiative_id`).
   - For each confirmed item: `kanban.work_item_create` with `status: backlog` and
     `metadata.source: project_idea_intake`.
   - `kanban.initiative_link_work_item` to link each created item to the initiative.
6. **Report** — `set_job_output` with the required fields, then `step_complete` with a
   concise summary the user sees.

**Ordering for partial-failure safety:** create the initiative first, then items, then
links; if creation fails partway, report what succeeded in `session_summary` rather
than silently dropping it.

## Error Handling

- **No confirmation / user abandons:** if the user never confirms a list, create
  nothing; `set_job_output` with empty `created_work_item_ids` and a `session_summary`
  explaining the session ended without capture. This is a valid, non-failure outcome.
- **Partial creation failure:** report created vs. intended in `session_summary`;
  do not convert a partial failure into a clean success claim.
- **Missing `ideaSeed`:** expected and handled — the agent opens by asking.

## Testing (TDD — Red first)

- **Workflow contract** (`apps/kanban/src/seeds/workflows.seed.contract.spec.ts`):
  - `workflow_id == project_idea_intake`; trigger is `manual`.
  - `ideate_and_capture` job exists with the required output-contract fields.
  - Effective allowed tools include `ask_user_questions`, `kanban.work_item_create`,
    `kanban.initiative_create`, `kanban.initiative_link_work_item`.
- **Agent profile contract** (api `agent-profile-seed.service.spec.ts` or the
  file-seed equivalent that covers `seed/agents/*/agent.json`): `idea-partner` is
  seeded, default-deny, and allows the expected tool surface; denies `write`/`bash`.
- **Seed-data validation** (`seed-data.validation.spec.ts`) stays green: every
  prompt-referenced tool is within `idea-partner`'s effective access.

## Documentation

- Add a `project_idea_intake` row to the workflow table in the
  `seed-workflow-patterns` agent skill.
- Mention the workflow in the `docs/guide` workflow catalog.

## Rollout

Seed files take effect on next API/kanban restart (upsert by `workflow_id` / profile
id). No migration required. After deploy, verify the workflow appears as a launchable
action on a project page and that a session creates an initiative with linked backlog
items.
