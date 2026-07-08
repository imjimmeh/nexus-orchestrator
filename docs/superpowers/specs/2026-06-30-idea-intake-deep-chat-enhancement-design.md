# Idea Intake — Deep Chat Brainstorming Enhancement

**Date:** 2026-06-30
**Status:** Design approved, pending implementation plan
**Type:** Enhancement of an existing seed workflow + agent profile

## Context

Users want a manually-initiated flow that takes a rough idea, helps them
hammer out the details conversationally (brainstorming-style), and — once
agreed — creates the resulting work items on a Kanban project board.

A flow already exists that covers most of this intent:

- **Workflow** `project_idea_intake` (`seed/workflows/project-idea-intake.workflow.yaml`)
- **Agent profile** `idea-partner` (`seed/agents/idea-partner/agent.json`)
- **Prompt** `seed/workflows/prompts/project-idea-intake/ideate.md`

It performs: conversational intake → one question at a time via
`ask_user_questions` → propose initiative + items → explicit confirmation
gate → create backlog work items linked to an initiative.

Rather than build a parallel duplicate (which violates DRY and the
project's aggressive-hygiene rules), this enhances the existing flow to
close four gaps.

## Gaps to close

| Aspect       | Existing behavior                                           | Target behavior                                                                           |
| ------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Surface      | `manual` launch only (project page)                         | `manual` **and** chat channel                                                             |
| Depth        | Hard cap: "3–5 turns / 2–6 items", deliberately lightweight | Adaptive: lightweight quick-capture preserved, deep brainstorm when the user wants detail |
| Item quality | Lightweight stubs (title + 1–2 sentences)                   | Implementation-ready on the deep path: AC-N (≥2, testable), priority, direct `dependsOn`  |
| Durable doc  | `session_summary` output field only                         | Persisted feature-brief **artifact**                                                      |

## Design

### Conversation surface (chat)

Chat ingress launches a workflow by `workflow_id` with an `input` payload
carrying `scopeId`, `message`, `objective`, and `agent_profile`. Follow-up
messages inject into the same run via `POST /workflows/runs/{runId}/inject`,
giving a long-lived multi-turn conversation.

- The chat client targets `workflow_id: project_idea_intake`.
- Chat does **not** supply `ideaSeed`; the prompt must read the starting
  idea from `trigger.ideaSeed` **or** fall back to `trigger.message` /
  `trigger.objective`.
- The `manual` trigger is retained so the board-launch surface keeps working.
  Chat is an additional entry point, not a replacement.

**Open risk (verify in plan):** confirm the run-request path accepts a chat
launch of a `manual`-triggered workflow (input shape / launch-input
validation). If it rejects, the fallback is adding chat-compatible trigger
handling rather than relying on the manual trigger.

### Adaptive depth

Replace the hard "3–5 turns / 2–6 items" cap with depth that matches the
user's appetite:

- Default remains lightweight quick-capture (preserves the existing path —
  no regression for current users).
- When the user signals they want to go deep, the agent explores: the
  problem/opportunity, target users, constraints, definition of success,
  edge cases, and 2–3 candidate approaches with trade-offs before settling.
- The agent stops refining when the picture is clear enough for the chosen
  depth, then moves to the confirmation gate.

### Implementation-ready items (deep path)

On the deep path, each created work item carries:

- A clear, descriptive title.
- A description body.
- An `## Acceptance Criteria` section using stable `AC-N` IDs, minimum 2,
  each independently testable (observable outcomes, not "works").
- A priority.
- Direct `dependsOn` links (only direct dependencies, no transitive
  redundancy).
- `status: backlog` (unchanged — nothing auto-dispatches until promoted).

### Feature-brief artifact

At the confirmation step, before creating items, the agent writes a durable
feature brief via `create_artifact` + `upsert_artifact_file`, capturing the
idea, rationale, and feature summary. Its id is surfaced in the workflow
output and referenced from the initiative/items for traceability.

### Grouping

Work items remain **flat** (no work-item parent/child nesting) but are
linked to a single **initiative** (existing behavior). The initiative is the
anchor the feature brief documents. This reconciles the "flat work items"
preference with the existing initiative grouping.

### Confirmation gate (unchanged contract, hard gate)

No Kanban records and no artifact-as-final are created before the user
explicitly approves the proposed breakdown. The agent presents the full
proposed set (initiative + items with their ACs + dependencies) and takes a
single "go ahead", then creates everything.

## Files changed

1. **`seed/workflows/prompts/project-idea-intake/ideate.md`** — primary work:
   chat idea-seed fallback, adaptive depth, implementation-ready item
   authoring, feature-brief artifact step.
2. **`seed/workflows/project-idea-intake.workflow.yaml`** — add artifact
   tools and a work-item list tool (grounding/dedupe) to both the workflow
   and job `tool_policy`; add `feature_brief_artifact_id` to `output_contract`.
3. **`seed/agents/idea-partner/agent.json`** — grant the same new tools at
   the profile level (runtime catalog = workflow ∩ profile).
4. **Seed contract tests** — `workflows.seed.contract.spec.ts` (apps/api and
   apps/kanban) and agent-profile seed tests: update expectations for the new
   grants and output contract.

## Tool grants added

- `create_artifact`, `upsert_artifact_file`, `list_artifacts` — feature brief.
- A work-item list/read tool (exact name to confirm in plan, e.g.
  `kanban.work_items` / `kanban.list_work_items`) — grounding and dedupe
  against existing board items.

(Existing grants retained: `ask_user_questions`, `read`, `ls`,
`query_memory`, `get_todo_list`, `manage_todo_list`, `kanban.project_state`,
`kanban.get_charter`, `kanban.initiative_create`,
`kanban.initiative_link_work_item`, `kanban.work_item_create`,
`set_job_output`, `step_complete`.)

## Output contract

Existing required fields retained: `initiative_id`, `created_work_item_ids`,
`session_summary`. Add: `feature_brief_artifact_id` (string).

## Out of scope

- Changing the autonomous lifecycle's treatment of initiatives.
- A new agent profile or a parallel workflow (explicitly rejected — enhance,
  don't duplicate).
- Web-UI affordance to select the workflow in chat (assumed to exist via the
  workflow selector; verify, but not built here).

## Testing approach

- TDD: extend the seed contract specs first (red) for the new tool grants and
  output-contract field, then update the seed YAML/JSON to pass (green).
- Verify the chat-launch feasibility risk before relying on it.
- Keep API/core Kanban-neutral; all Kanban specifics stay in the seed
  workflow/prompt and Kanban-owned tools.
