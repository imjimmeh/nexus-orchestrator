# Idea Intake — Deep Chat Brainstorming Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the existing `project_idea_intake` workflow + `idea-partner` profile so a user can brainstorm an idea over chat (deeply, when they want), then create implementation-ready backlog work items plus a durable feature-brief artifact — without building a duplicate flow.

**Architecture:** This is a **seed-data + contract-test** change only. No API/core TypeScript runtime change is required: a prior investigation confirmed the chat→core run path (`POST /internal/core/workflow-runs`) launches a `manual`-trigger workflow with no launch-contract validation, and exposes all chat input fields (`trigger.scopeId`, `trigger.message`, `trigger.objective`, `trigger.agent_profile`) to the prompt's Handlebars templating. We edit three seed files (agent JSON, workflow YAML, prompt MD) and extend one Vitest contract spec.

**Tech Stack:** YAML workflow definitions, JSON agent profiles, Handlebars-templated Markdown prompts, Vitest (`apps/kanban`), Kanban MCP tools (`kanban.*`) and API capability tools (`create_artifact`, `upsert_artifact_file`, `list_artifacts`).

## Global Constraints

- **Kanban-neutrality:** API/core code stays Kanban-neutral. All changes here live under `seed/` (workflow/prompt/agent) and `apps/kanban` tests — never teach `apps/api`/`packages/core` the Kanban domain. (CLAUDE.md "Core/Kanban Boundary".)
- **No lint suppression:** Never add `eslint-disable`, `@ts-ignore`, or rule downgrades. Fix findings in code.
- **TDD:** Red → Green → Refactor. Contract tests first where a test exists for the surface.
- **Tool availability rule:** A job's runtime tool catalog = `workflow tool_policy` ∩ `agent profile tool_policy`. Every newly granted tool MUST be added in **both** the workflow YAML (workflow-level _and_ job-level `tool_policy`) **and** the `idea-partner` agent JSON, or it will not materialize at runtime.
- **Artifact scope:** `create_artifact`'s `scope` is the enum `"global" | "profile"` — it is NOT project-bound. The feature brief is a global artifact; bind it to the project by putting `project_id` in its `metadata`.
- **Output-contract exactness:** `expectExecutionJobRequiredOutputFields` asserts `output_contract.required` with `toEqual` (exact array, order-sensitive). The YAML `required:` list and the test's expected array must match element-for-element, in order.
- **Status unchanged:** Created work items use `status: backlog`. Nothing auto-dispatches.
- **No new files except docs:** Reuse `project_idea_intake` / `idea-partner`. Do not create a new workflow or profile.

---

## File Structure

| File                                                    | Responsibility                                                             | Action                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `seed/agents/idea-partner/agent.json`                   | Profile-level tool ceiling for the persona                                 | Modify — add 4 allow rules (string form)                                                                  |
| `seed/agents/idea-partner/PROMPT.md`                    | Persona/system prompt                                                      | Modify — adaptive depth, artifact capability, new output field                                            |
| `seed/workflows/project-idea-intake.workflow.yaml`      | Workflow contract: triggers, tool policy (workflow + job), output contract | Modify — add 4 tool grants in both policies, add output field                                             |
| `seed/workflows/prompts/project-idea-intake/ideate.md`  | The step task prompt (the brainstorm flow)                                 | Rewrite — chat seed fallback, adaptive depth, impl-ready items, brief artifact, scope guard               |
| `apps/kanban/src/seeds/workflows.seed.contract.spec.ts` | Contract tests for the workflow + profile                                  | Modify — update output-fields test, add tool-grant tests, prompt-content tests, profile-intersection test |

**Tools being granted (exact names):**

- `create_artifact` — create the feature-brief artifact entry (API capability).
- `upsert_artifact_file` — write the brief Markdown into the artifact.
- `list_artifacts` — let the agent find/avoid duplicate briefs.
- `kanban.work_items` — list existing board items for grounding/dedupe (`project_id` optional, `limit`/`offset`).

---

## Task 1: Grant the new capability surface (tools + output field)

Adds the four tool grants in all required policy layers and the new required output field, driven by failing contract tests first.

**Files:**

- Test: `apps/kanban/src/seeds/workflows.seed.contract.spec.ts` (inside `describe("project_idea_intake workflow", ...)`, which currently ends at the `})` following the "confirm before creating anything" test)
- Modify: `seed/workflows/project-idea-intake.workflow.yaml`
- Modify: `seed/agents/idea-partner/agent.json`

**Interfaces:**

- Consumes (existing test helpers, do not redefine): `expectEffectiveAllowedToolsToContain(seedFile: string, jobId: string, tool: string)`, `expectExecutionJobRequiredOutputFields(seedFile: string, jobId: string, fields: string[])`, `getEffectiveAllowedTools(seedFile, jobId): Set<string>`, `readSeedRoot(filename: string): string`. `SEED_FILE = "project-idea-intake.workflow.yaml"`, `jobId = "ideate_and_capture"`.
- Produces: workflow + profile both grant `create_artifact`, `upsert_artifact_file`, `list_artifacts`, `kanban.work_items`; job `output_contract.required` becomes `["initiative_id","created_work_item_ids","session_summary","feature_brief_artifact_id"]`.

- [ ] **Step 1: Write the failing tests**

In `apps/kanban/src/seeds/workflows.seed.contract.spec.ts`, update the existing output-fields test (currently expecting three fields) to expect four, and add new grant + intersection tests. Replace the existing `it("ideate_and_capture requires output fields", ...)` body and insert the new `it(...)` blocks immediately after the existing `it("grants kanban.initiative_link_work_item ...")` test:

```typescript
it("ideate_and_capture requires output fields", () => {
  expectExecutionJobRequiredOutputFields(SEED_FILE, "ideate_and_capture", [
    "initiative_id",
    "created_work_item_ids",
    "session_summary",
    "feature_brief_artifact_id",
  ]);
});

it("grants create_artifact to the ideate_and_capture job", () => {
  expectEffectiveAllowedToolsToContain(
    SEED_FILE,
    "ideate_and_capture",
    "create_artifact",
  );
});

it("grants upsert_artifact_file to the ideate_and_capture job", () => {
  expectEffectiveAllowedToolsToContain(
    SEED_FILE,
    "ideate_and_capture",
    "upsert_artifact_file",
  );
});

it("grants list_artifacts to the ideate_and_capture job", () => {
  expectEffectiveAllowedToolsToContain(
    SEED_FILE,
    "ideate_and_capture",
    "list_artifacts",
  );
});

it("grants kanban.work_items to the ideate_and_capture job", () => {
  expectEffectiveAllowedToolsToContain(
    SEED_FILE,
    "ideate_and_capture",
    "kanban.work_items",
  );
});

it("idea-partner profile grants the new tools the workflow grants", () => {
  const agentConfig = JSON.parse(
    readSeedRoot("agents/idea-partner/agent.json"),
  ) as { tool_policy?: { rules?: unknown[] } };
  const rules = agentConfig.tool_policy?.rules ?? [];
  for (const tool of [
    "create_artifact",
    "upsert_artifact_file",
    "list_artifacts",
    "kanban.work_items",
  ]) {
    expect(rules).toContain(`allow ${tool} *`);
  }
});
```

> Note: keep the existing `it("does not grant bash or write ...")` test as-is — the new tools do not include bash/write/edit, so it still passes.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=apps/kanban -- workflows.seed.contract.spec.ts -t "project_idea_intake"`
Expected: FAIL — the output-fields test fails (`feature_brief_artifact_id` missing), the four grant tests fail (`toContain` misses the tool), and the profile-intersection test fails (`allow create_artifact *` not in rules).

- [ ] **Step 3: Add the four grants to the workflow YAML (both policy layers)**

In `seed/workflows/project-idea-intake.workflow.yaml`, add the four rules to the **workflow-level** `permissions.tool_policy.rules` (the block starting at `permissions:` near the top) AND to the **job-level** `permissions.tool_policy.rules` inside the `ideate_and_capture` job. Append these four entries to each `rules:` list:

```yaml
- effect: allow
  tool: kanban.work_items
- effect: allow
  tool: create_artifact
- effect: allow
  tool: upsert_artifact_file
- effect: allow
  tool: list_artifacts
```

- [ ] **Step 4: Add the new required output field to the YAML**

In the same file, update the `ideate_and_capture` job's `output_contract` so `required` lists the new field last and `types` includes it:

```yaml
output_contract:
  required:
    - initiative_id
    - created_work_item_ids
    - session_summary
    - feature_brief_artifact_id
  types:
    initiative_id: string
    created_work_item_ids:
      type: array
      items: string
    session_summary: string
    feature_brief_artifact_id: string
```

- [ ] **Step 5: Add the four grants to the agent profile**

In `seed/agents/idea-partner/agent.json`, append four string rules to `tool_policy.rules` (match the file's existing string-rule style):

```json
        "allow kanban.work_items *",
        "allow create_artifact *",
        "allow upsert_artifact_file *",
        "allow list_artifacts *"
```

Ensure the preceding rule (`"allow step_complete *"` or whichever is currently last) keeps a trailing comma and the array stays valid JSON.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test --workspace=apps/kanban -- workflows.seed.contract.spec.ts -t "project_idea_intake"`
Expected: PASS — all project_idea_intake tests green, including the new grant, output-field, and intersection tests.

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/seeds/workflows.seed.contract.spec.ts \
  seed/workflows/project-idea-intake.workflow.yaml \
  seed/agents/idea-partner/agent.json
git commit -m "feat(idea-intake): grant artifact + work-item-list tools and feature-brief output field"
```

---

## Task 2: Rewrite the brainstorm prompt and persona

Replaces the lightweight-only `ideate.md` with the adaptive, chat-aware, implementation-ready flow, and aligns the persona prompt. Prompt-content contract tests are added first.

**Files:**

- Test: `apps/kanban/src/seeds/workflows.seed.contract.spec.ts` (project_idea_intake describe block)
- Rewrite: `seed/workflows/prompts/project-idea-intake/ideate.md`
- Modify: `seed/agents/idea-partner/PROMPT.md`

**Interfaces:**

- Consumes: `getExecutionStepPrompt(seedFile, jobId, stepId): string` (returns the raw `prompt_file` Markdown), `SEED_FILE`, `stepId = "ideate"`.
- Produces: a prompt that references the chat seed fallback (`trigger.message`), `create_artifact`/`upsert_artifact_file`, the `## Acceptance Criteria` standard, and `feature_brief_artifact_id`.

- [ ] **Step 1: Write the failing prompt-content tests**

Add these `it(...)` blocks inside the `describe("project_idea_intake workflow", ...)` block (e.g. right after the existing `it("ideate_and_capture prompt references kanban.initiative_link_work_item", ...)`):

```typescript
it("ideate_and_capture prompt falls back to the chat message for the idea seed", () => {
  const prompt = getExecutionStepPrompt(
    SEED_FILE,
    "ideate_and_capture",
    "ideate",
  );
  expect(prompt).toContain("trigger.message");
});

it("ideate_and_capture prompt references the feature-brief artifact tools", () => {
  const prompt = getExecutionStepPrompt(
    SEED_FILE,
    "ideate_and_capture",
    "ideate",
  );
  expect(prompt).toContain("create_artifact");
  expect(prompt).toContain("upsert_artifact_file");
});

it("ideate_and_capture prompt requires structured acceptance criteria", () => {
  const prompt = getExecutionStepPrompt(
    SEED_FILE,
    "ideate_and_capture",
    "ideate",
  );
  expect(prompt).toContain("## Acceptance Criteria");
  expect(prompt).toMatch(/AC-1/);
});

it("ideate_and_capture prompt reports the feature_brief_artifact_id output", () => {
  const prompt = getExecutionStepPrompt(
    SEED_FILE,
    "ideate_and_capture",
    "ideate",
  );
  expect(prompt).toContain("feature_brief_artifact_id");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=apps/kanban -- workflows.seed.contract.spec.ts -t "project_idea_intake"`
Expected: FAIL — the four new prompt-content tests fail (current `ideate.md` lacks `trigger.message`, `create_artifact`, `## Acceptance Criteria`, `feature_brief_artifact_id`).

- [ ] **Step 3: Rewrite `ideate.md`**

Replace the entire contents of `seed/workflows/prompts/project-idea-intake/ideate.md` with:

````markdown
## Idea Intake Session

You are the idea intake partner for project **{{trigger.scopeId}}**.

Your job is to help the user turn an idea into something actionable and capture
it as a kanban initiative with a set of backlog work items. You can run this
**lightly** (a quick 3–5 turn capture) or **deeply** (hammer out the details) —
match the user's appetite. Do not force a heavy process onto someone who wants a
quick capture, and do not stop short when they want to go deep.

### Step 0 — Check you have a project

If `{{trigger.scopeId}}` is empty, you are not attached to a project and cannot
create kanban records. Use `ask_user_questions` to ask the user which project
this idea belongs to, and do not attempt to create anything until you have a
project id. If they cannot provide one, summarize the discussion and stop.

### Step 1 — Ground yourself

Before responding, call `kanban.project_state` to understand the project.
Optionally call `kanban.get_charter` for richer context. Call `kanban.work_items`
(with `project_id` set to `{{trigger.scopeId}}`) to see what already exists, so
you do not propose duplicates of existing work. Do not skip grounding.

### Step 2 — Open the conversation

The starting idea may arrive as a launch input or as the user's first chat
message. Use whichever is present:

{{#if trigger.ideaSeed}}
The user has shared a starting thought:

> {{trigger.ideaSeed}}
> {{else}}{{#if trigger.message}}
> The user has shared a starting thought:

> {{trigger.message}}
> {{else}}{{#if trigger.objective}}
> The user has shared a starting thought:

> {{trigger.objective}}
> {{else}}
> The user hasn't shared a starting thought yet. Call `ask_user_questions` with a
> single open question: ask them what idea they'd like to explore.
> {{/if}}{{/if}}{{/if}}

Reflect the idea back briefly, then ask a focused follow-up.

### Step 3 — Ideate and refine (loop)

Use `ask_user_questions` to guide the conversation. Ask **one focused question at
a time** — never dump a list of questions. Adapt your depth:

- **Light capture:** cover the problem/opportunity, what success looks like, and
  the rough shape of the work. A few turns is enough.
- **Deep brainstorm (when the user wants detail):** also explore target users,
  constraints, edge cases, and 2–3 candidate approaches with their trade-offs
  before settling on one. Help the user sharpen their thinking; reflect their
  language back rather than imposing structure.

Stop refining once the picture is clear enough for the chosen depth and you have
a concrete list of work items.

### Step 4 — Propose and confirm (hard gate)

Before creating anything, present the full proposed breakdown in the chat:

1. An **initiative title and description** capturing the refined idea.
2. The **work items**. For a deep session each item must be
   implementation-ready:
   - A clear, descriptive title.
   - A description body.
   - An `## Acceptance Criteria` section with stable `AC-N` ids (minimum 2),
     each independently testable as an observable outcome (e.g. "endpoint
     returns 201 with body X", not "works").
   - A priority.
   - Direct dependencies on other items in this same set (only direct ones).

Then call `ask_user_questions` to get **explicit confirmation**. Let the user
add, remove, rename, or re-scope items. Do **not** create any kanban records or
artifacts until they say go.

If the user decides not to proceed, call `set_job_output` once with:

```json
{
  "data": {
    "initiative_id": "",
    "created_work_item_ids": [],
    "session_summary": "Session ended without capture — user chose not to proceed.",
    "feature_brief_artifact_id": ""
  }
}
```

Then call `step_complete` with a brief summary and stop.

### Step 5 — Capture on confirmation

On confirmation, create in this order to keep dependencies valid and minimize
partial-failure risk:

1. **Feature brief artifact.** Call `create_artifact` with:
   - `name`: `"Feature Brief: <initiative title>"`
   - `description`: a one-line summary of the idea
   - `scope`: `"global"`
   - `metadata`: `{ "project_id": "{{trigger.scopeId}}", "source": "project_idea_intake" }`

   Capture the returned artifact id as `feature_brief_artifact_id`. Then call
   `upsert_artifact_file` with that `artifact_id`, `relative_path`: `"brief.md"`,
   and `content`: a Markdown brief covering the idea, the rationale/why now, and
   a summary of the agreed feature and its work items.

2. **Initiative.** Call `kanban.initiative_create` with:
   - `project_id`: `{{trigger.scopeId}}`
   - `title`: the agreed initiative title
   - `description`: the agreed description, ending with a line
     `Feature brief artifact: <feature_brief_artifact_id>`.

   Capture the returned `id` as `initiative_id`.

3. **Work items, in dependency order** (create items with no dependencies first,
   so a dependency's id already exists before the dependent item is created).
   For each item call `kanban.work_item_create` with:
   - `project_id`: `{{trigger.scopeId}}`
   - `workItem.title`: the item title
   - `workItem.description`: the description **including** the
     `## Acceptance Criteria` section
   - `workItem.priority`: the agreed priority
   - `workItem.status`: `"backlog"`
   - `workItem.dependsOn`: an array of the ids of already-created items this one
     depends on (omit or use `[]` when there are none)
   - `workItem.metadata`: `{ "source": "project_idea_intake", "feature_brief_artifact_id": "<feature_brief_artifact_id>" }`

   Capture each returned `id`.

4. **Link items to the initiative.** For each created work item call
   `kanban.initiative_link_work_item` with:
   - `project_id`: `{{trigger.scopeId}}`
   - `work_item_id`: the item id
   - `initiative_id`: the initiative id from step 2.

### Step 6 — Report results

Call `set_job_output` exactly once with all four fields:

```json
{
  "data": {
    "initiative_id": "<id from kanban.initiative_create>",
    "created_work_item_ids": ["<id1>", "<id2>"],
    "session_summary": "Brief summary of the idea and what was created",
    "feature_brief_artifact_id": "<id from create_artifact>"
  }
}
```

If creation failed partway, report what succeeded in `session_summary` and use
the real ids/empty values for the rest — do not claim full success.

Then call `step_complete` with a short, user-friendly summary of what was created
(initiative, item count, and that a feature brief was saved).

### Rules

- Do not create kanban records or the feature-brief artifact before explicit user
  confirmation in Step 4.
- Do not use `write`, `edit`, or `bash` — this session only talks, reads the
  board, writes kanban records, and writes the feature-brief artifact.
- Ask one question at a time with `ask_user_questions`.
- Call `set_job_output` exactly once, at the end.
- If the user abandons mid-session, record what was discussed in
  `session_summary` and use empty values for the other output fields.
````

- [ ] **Step 4: Align the persona prompt**

Edit `seed/agents/idea-partner/PROMPT.md` to remove the hard "lightweight 3–5 turn" cap and reflect the new capabilities. Change the conversation-style bullet that says the process is always lightweight to adaptive depth, and update the capture-flow list to mention the brief artifact and the new output field. Specifically:

- Replace the bullet `- Keep the process lightweight. A 3–5 turn conversation is usually enough. Stop when you have a clear-enough idea and a rough list of 2–6 work items.` with:
  `- Match the user's appetite: a quick 3–5 turn capture when they want speed, or a deeper brainstorm (users, constraints, edge cases, candidate approaches) when they want the details hammered out.`
- In the capture-flow list, after creating items, add a line noting the agent also writes a durable feature brief via `create_artifact` + `upsert_artifact_file` and reports `feature_brief_artifact_id` in `set_job_output`.
- Leave the `- Do not use write, edit, or bash` rule intact (artifact tools are separate and still allowed).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace=apps/kanban -- workflows.seed.contract.spec.ts -t "project_idea_intake"`
Expected: PASS — all prompt-content tests green, and the previously-passing prompt tests (`ask_user_questions`, `kanban.initiative_create`, `kanban.work_item_create`, `kanban.initiative_link_work_item`, confirm/`set_job_output`) still pass because the rewritten prompt still references those tokens.

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/seeds/workflows.seed.contract.spec.ts \
  seed/workflows/prompts/project-idea-intake/ideate.md \
  seed/agents/idea-partner/PROMPT.md
git commit -m "feat(idea-intake): adaptive deep brainstorm prompt with chat seed, AC-N items, feature brief"
```

---

## Task 3: Full verification and documentation

Validates the whole seed set parses and the docs reflect the new behavior.

**Files:**

- Verify only: seed loaders / contract specs
- Modify (if a relevant section exists): a guide doc under `docs/guide/`

- [ ] **Step 1: Run the full kanban seed contract spec**

Run: `npm run test --workspace=apps/kanban -- workflows.seed.contract.spec.ts`
Expected: PASS — no regressions across the whole contract suite (other workflows unaffected).

- [ ] **Step 2: Validate seed data parses end-to-end**

Run: `npm run validate:seed-data`
Expected: PASS — `project-idea-intake.workflow.yaml` and `idea-partner/agent.json` parse with the new grants and output contract; no schema errors.

- [ ] **Step 3: Run the API agent-profile seed spec (no regression from the profile change)**

Run: `npm run test --workspace=apps/api -- agent-profiles.seed.spec.ts`
Expected: PASS — the generic profile invariants (e.g. "does not mix legacy tool arrays with tool_policy", "grants search_skills to every active seeded agent") still hold for `idea-partner` after adding the string rules.

- [ ] **Step 4: Update documentation**

Search `docs/guide/` for any existing description of idea intake or chat-launchable workflows:

Run: `grep -ril "idea.intake\|idea-partner" docs/guide docs/architecture 2>/dev/null`

If a relevant doc exists, update it to note: (a) the workflow is now launchable from chat (targets `workflow_id: project_idea_intake`; first chat message seeds the idea), (b) it produces implementation-ready backlog items plus a feature-brief artifact, and (c) depth is adaptive. If no such doc exists, add a short subsection to the most relevant workflow/guide index (e.g. a "Conversational idea intake" note in `docs/guide/README.md`). Keep it to a short paragraph — do not invent unrelated docs.

- [ ] **Step 5: Commit any doc changes**

```bash
git add docs/guide
git commit -m "docs(idea-intake): document chat-launchable deep brainstorm intake"
```

---

## Post-implementation (not code tasks — surface to the user)

These are operational follow-ups the autonomous test cycle cannot perform; list them in the completion summary:

1. **Reseed** the running stack so the updated workflow/profile/prompt take effect (seed changes are not live until reseeded).
2. **Live verification:** start a chat bound to a project, target `project_idea_intake`, confirm the multi-turn brainstorm parks/injects correctly, approve a breakdown, and verify backlog items + the feature-brief artifact are created.
3. **Web UI selection:** confirm the chat UI exposes a way to select this workflow (or set `CHAT_DEFAULT_WORKFLOW_ID` / per-channel routing). If it does not, that is a separate small UI task, out of scope for this plan.

---

## Self-Review

**Spec coverage:**

- Chat surface → Task 2 (prompt `trigger.message`/`objective` fallback) + confirmed no code change needed. ✓
- Adaptive depth → Task 2 Step 3 (Step 3 of prompt) + Task 2 Step 4 (persona). ✓
- Implementation-ready items (AC-N, priority, dependsOn) → Task 2 Step 3 (Steps 4–5 of prompt) + Task 2 Step 1 AC test. ✓
- Feature-brief artifact → Task 1 (grants + output field) + Task 2 (prompt create_artifact/upsert_artifact_file). ✓
- Initiative kept / flat items → prompt Step 5 retains `kanban.initiative_create` + `kanban.initiative_link_work_item`, items have no parent nesting. ✓
- Seed contract tests → Task 1 + Task 2 test steps. ✓
- Grounding/dedupe (`kanban.work_items`) → Task 1 grant + prompt Step 1. ✓
- Output contract `feature_brief_artifact_id` → Task 1 Steps 1/4. ✓
- scopeId-absent guard → prompt Step 0. ✓

**Placeholder scan:** No TBD/TODO; full prompt content and full test code provided. Doc step (Task 3 Step 4) is conditional-but-concrete (grep, then update-or-add a short paragraph). ✓

**Type/name consistency:** `feature_brief_artifact_id` (output field + metadata + prompt JSON), `kanban.work_items`, `create_artifact`, `upsert_artifact_file`, `list_artifacts`, `ideate_and_capture`, `SEED_FILE` used consistently across tasks. Output-contract array order identical in YAML (Task 1 Step 4) and test (Task 1 Step 1). Artifact `scope: "global"` matches the enum. `dependsOn` matches `getInputDependencyIds` (merges `dependsOn`/`dependencyIds`). ✓
