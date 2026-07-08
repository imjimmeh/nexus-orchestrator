# Refactoring Analysis Context Bounding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `codebase_refactoring_analysis` workflow from overflowing agent context on large monorepos by capping findings per subagent, hard-capping tickets per run, having subagents create their own tickets, and rotating modules across runs via committed per-run coverage files.

**Architecture:** Subagents cap to top-N findings (scoped var), dedup against existing items, and create their own work items, returning only compact summaries. The coordinator reads recent per-run coverage files to pick the stalest modules within a per-run ticket budget, and sums counts instead of aggregating findings. The repurposed finalize step does a light cross-module dedup sweep and writes one small markdown coverage file per run (named with `{{ now }}` date + run id). A new `now` handlebars helper supplies the timestamp.

**Tech Stack:** NestJS (apps/api), Handlebars templating, Vitest, js-yaml, YAML seed workflows + markdown prompt files, JSON seed variables.

## Global Constraints

- **No lint suppression** — never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix in code.
- **Core/Kanban boundary** — API/core code stays Kanban-neutral. This change only touches seed YAML/prompts (which may reference `kanban.*` tools, as the existing workflow already does) and generic workflow templating; do not add Kanban domain logic to `apps/api/src` or `packages/core`.
- **One concern per file** — follow the existing `registerComparisonHelpers` / `registerBooleanHelpers` file-per-concern pattern.
- **Strong typing** — no `any`; mirror existing `unknown`-based helper signatures.
- **TDD** — write the failing test first for every task; commit after green.
- **Vitest commands** run from repo root: `npm run test --workspace=apps/api -- <path>`.
- **Scoped var defaults** (exact values): `analysis.refactoring_findings_cap` = 3, `analysis.refactoring_run_item_budget` = 20, `analysis.refactoring_rotation_lookback_runs` = 10 (all `valueType: number`).
- **Coverage file path/format:** `docs/analysis/refactoring/<utc-date>-<run_id>.md`; the `## Modules analyzed` bullet list (`- <module_path> — <outcome> (<count>)[: <ids>]`) is the parse contract between writer and reader.

---

### Task 1: `now` handlebars helper

**Files:**

- Create: `apps/api/src/workflow/workflow-date-helpers.ts`
- Modify: `apps/api/src/workflow/state-manager.service.ts:5-28` (imports + registration block)
- Test: `apps/api/src/workflow/workflow-date-helpers.spec.ts`

**Interfaces:**

- Produces: `registerDateHelpers(hbs: { registerHelper(name: string, fn: (...args: unknown[]) => unknown): void }): void` — registers a `now` helper returning the current time as an ISO-8601 UTC string.
- Consumes: `StateManagerService.substituteTemplate(template: string, variables: Record<string, unknown>): string` (existing public method) to verify the helper renders through the real Handlebars instance.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-date-helpers.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { StateManagerService } from "./state-manager.service";

describe("now handlebars helper", () => {
  it("renders the current time as an ISO-8601 UTC string via substituteTemplate", () => {
    const svc = new StateManagerService({} as never);

    const rendered = svc.substituteTemplate("{{ now }}", {}).trim();

    expect(rendered).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(rendered))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-date-helpers.spec.ts`
Expected: FAIL — `{{ now }}` renders empty (helper not registered), so the regex assertion fails.

- [ ] **Step 3: Create the helper file**

Create `apps/api/src/workflow/workflow-date-helpers.ts`:

```ts
type HelperHost = {
  registerHelper(name: string, fn: (...args: unknown[]) => unknown): void;
};

/**
 * Registers date/time template helpers on a Handlebars instance.
 *
 * `now` returns the current time as an ISO-8601 UTC string, e.g.
 * `2026-06-19T03:00:00.000Z`. It is intentionally NON-DETERMINISTIC and must
 * not be used in step `condition`s or anywhere workflow diffing/dry-run assumes
 * a stable render — it is for injecting timestamps into prompt/file content
 * only. Handlebars passes its `options` object as the trailing argument, which
 * the zero-arg implementation ignores naturally.
 */
export function registerDateHelpers(hbs: HelperHost): void {
  hbs.registerHelper("now", () => new Date().toISOString());
}
```

- [ ] **Step 4: Register the helper in StateManagerService**

In `apps/api/src/workflow/state-manager.service.ts`, add the import next to the existing helper imports (after line 6):

```ts
import { registerDateHelpers } from "./workflow-date-helpers";
```

And add the registration call after `registerBooleanHelpers(hbs);` (line 28):

```ts
registerDateHelpers(hbs);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- workflow-date-helpers.spec.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run build:api` (or `npm run lint:api` if faster) to confirm no type errors in the touched files.

```bash
git add apps/api/src/workflow/workflow-date-helpers.ts apps/api/src/workflow/workflow-date-helpers.spec.ts apps/api/src/workflow/state-manager.service.ts
git commit -m "feat(workflow): add now handlebars helper for templated timestamps"
```

---

### Task 2: Seed the three analysis scoped variables

**Files:**

- Modify: `seed/variables/orchestration-defaults.json`
- Test: `apps/api/src/database/seeds/variables/orchestration-defaults.contract.spec.ts` (create)

**Interfaces:**

- Produces: three new global default variables readable in workflow templates as `{{ vars.analysis.refactoring_findings_cap }}`, `{{ vars.analysis.refactoring_run_item_budget }}`, `{{ vars.analysis.refactoring_rotation_lookback_runs }}`.

Note: the existing `scoped-variables.seed.spec.ts` uses a temp fixture and does NOT read the real defaults file, so this task adds a dedicated contract spec that reads the committed `orchestration-defaults.json`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/database/seeds/variables/orchestration-defaults.contract.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULTS_PATH = resolve(
  __dirname,
  "../../../../../../seed/variables/orchestration-defaults.json",
);

interface SeedVariable {
  key: string;
  value: unknown;
  valueType: string;
}

function variablesByKey(): Record<string, SeedVariable> {
  const parsed = JSON.parse(readFileSync(DEFAULTS_PATH, "utf8")) as {
    variables: SeedVariable[];
  };
  return Object.fromEntries(parsed.variables.map((v) => [v.key, v]));
}

describe("orchestration default variables — refactoring analysis", () => {
  it.each([
    ["analysis.refactoring_findings_cap", 3],
    ["analysis.refactoring_run_item_budget", 20],
    ["analysis.refactoring_rotation_lookback_runs", 10],
  ])("seeds %s = %i as a number", (key, value) => {
    const v = variablesByKey()[key];
    expect(v).toBeDefined();
    expect(v.value).toBe(value);
    expect(v.valueType).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- orchestration-defaults.contract.spec.ts`
Expected: FAIL — keys are not yet in the defaults file (`v` is undefined).

- [ ] **Step 3: Add the variables to the defaults file**

In `seed/variables/orchestration-defaults.json`, add these three entries to the `variables` array (after the existing `promotion.max_items_per_cycle` entry):

```json
{
  "key": "analysis.refactoring_findings_cap",
  "value": 3,
  "valueType": "number"
},
{
  "key": "analysis.refactoring_run_item_budget",
  "value": 20,
  "valueType": "number"
},
{
  "key": "analysis.refactoring_rotation_lookback_runs",
  "value": 10,
  "valueType": "number"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- orchestration-defaults.contract.spec.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add seed/variables/orchestration-defaults.json apps/api/src/database/seeds/variables/orchestration-defaults.contract.spec.ts
git commit -m "feat(variables): seed refactoring-analysis cap, run-budget, lookback defaults"
```

---

### Task 3: Restructure the workflow YAML (jobs, contracts, tools, wiring)

**Files:**

- Modify: `seed/workflows/codebase_refactoring_analysis.workflow.yaml`
- Test: `apps/api/src/database/seeds/workflow/codebase-refactoring-analysis.contract.spec.ts` (create)

**Interfaces:**

- Produces (job graph the prompts in Tasks 4–5 rely on):
  - `scan_codebase.output_contract.required` = `[items_created, duplicates_skipped, created_items, scope_manifest]`.
  - Job `cross_module_dedup` (replaces `dedup_and_create`), `depends_on: [scan_codebase]`, `output_contract.required: [merged]`, prompt `prompts/codebase-refactoring-analysis/cross-module-dedup.md`.
  - `commit_findings` and `emit_analysis_complete` both `depends_on: [cross_module_dedup]`.

- [ ] **Step 1: Write the failing contract test**

Create `apps/api/src/database/seeds/workflow/codebase-refactoring-analysis.contract.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";

const SEED_PATH = resolve(
  __dirname,
  "../../../../../../seed/workflows/codebase_refactoring_analysis.workflow.yaml",
);

interface Rule {
  effect: "allow" | "deny";
  tool: string;
}
interface Job {
  id: string;
  depends_on?: string[];
  output_contract?: { required?: string[] };
  permissions?: { tool_policy?: { rules?: Rule[] } };
  steps?: { id: string; prompt_file?: string }[];
  inputs?: Record<string, unknown>;
}

function def() {
  return load(readFileSync(SEED_PATH, "utf8")) as { jobs: Job[] };
}
function jobsById(): Record<string, Job> {
  return Object.fromEntries(def().jobs.map((j) => [j.id, j]));
}
function allows(job: Job, tool: string): boolean {
  return !!job.permissions?.tool_policy?.rules?.some(
    (r) => r.effect === "allow" && r.tool === tool,
  );
}

describe("codebase_refactoring_analysis workflow contract", () => {
  it("scan_codebase outputs counts, not the old findings array", () => {
    const required = jobsById().scan_codebase.output_contract?.required ?? [];
    expect(required).toEqual([
      "items_created",
      "duplicates_skipped",
      "created_items",
      "scope_manifest",
    ]);
    expect(required).not.toContain("refactoring_findings");
  });

  it("scan_codebase lets subagents list and create work items", () => {
    const job = jobsById().scan_codebase;
    expect(allows(job, "kanban.list_work_items")).toBe(true);
    expect(allows(job, "kanban.work_item_create")).toBe(true);
  });

  it("replaces dedup_and_create with a light cross_module_dedup finalize job", () => {
    const jobs = jobsById();
    expect(jobs.dedup_and_create).toBeUndefined();
    const finalize = jobs.cross_module_dedup;
    expect(finalize).toBeDefined();
    expect(finalize.depends_on).toEqual(["scan_codebase"]);
    expect(finalize.output_contract?.required).toEqual(["merged"]);
    expect(allows(finalize, "write")).toBe(true);
    expect(allows(finalize, "edit")).toBe(true);
    expect(allows(finalize, "kanban.work_item_transition_status")).toBe(true);
    expect(allows(finalize, "kanban.work_item_create")).toBe(false);
    expect(finalize.steps?.[0].prompt_file).toBe(
      "prompts/codebase-refactoring-analysis/cross-module-dedup.md",
    );
  });

  it("downstream jobs depend on cross_module_dedup, not dedup_and_create", () => {
    const jobs = jobsById();
    expect(jobs.commit_findings.depends_on).toEqual(["cross_module_dedup"]);
    expect(jobs.emit_analysis_complete.depends_on).toEqual([
      "cross_module_dedup",
    ]);
    const raw = readFileSync(SEED_PATH, "utf8");
    expect(raw).not.toContain("dedup_and_create");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- codebase-refactoring-analysis.contract.spec.ts`
Expected: FAIL — `dedup_and_create` still exists, contracts/tools not yet updated.

- [ ] **Step 3: Update `scan_codebase` output contract + tools**

In `seed/workflows/codebase_refactoring_analysis.workflow.yaml`, replace the `scan_codebase` `output_contract` block:

```yaml
output_contract:
  required: [items_created, duplicates_skipped, created_items, scope_manifest]
  types:
    items_created: integer
    duplicates_skipped: integer
```

And add these two allow rules inside `scan_codebase.permissions.tool_policy.rules` (next to the existing `kanban.project_state` allow):

```yaml
- effect: allow
  tool: kanban.list_work_items
- effect: allow
  tool: kanban.work_item_create
```

- [ ] **Step 4: Replace the `dedup_and_create` job with `cross_module_dedup`**

Replace the entire `dedup_and_create` job block with:

```yaml
- id: cross_module_dedup
  type: execution
  tier: heavy
  depends_on: [scan_codebase]
  output_contract:
    required: [merged]
    types:
      merged: integer
  inputs:
    agent_profile: architect-agent
  permissions:
    tool_policy:
      default: deny
      rules:
        - effect: allow
          tool: search_skills
        - effect: allow
          tool: read
        - effect: allow
          tool: ls
        - effect: allow
          tool: write
        - effect: allow
          tool: edit
        - effect: allow
          tool: set_job_output
        - effect: allow
          tool: step_complete
        - effect: allow
          tool: kanban.list_work_items
        - effect: allow
          tool: kanban.work_item
        - effect: allow
          tool: kanban.work_item_transition_status
        - effect: allow
          tool: kanban.work_item_patch_metadata
        - effect: allow
          tool: get_todo_list
        - effect: allow
          tool: manage_todo_list
        - effect: deny
          tool: bash
        - effect: deny
          tool: spawn_subagent_async
  steps:
    - id: cross_module_dedup
      prompt_file: prompts/codebase-refactoring-analysis/cross-module-dedup.md
```

- [ ] **Step 5: Update `commit_findings` and `emit_analysis_complete` wiring**

Change `commit_findings.depends_on` from `[dedup_and_create]` to `[cross_module_dedup]`, and its `message` to `"docs(analysis): persist refactoring analysis coverage"`.

Replace the `emit_analysis_complete` job with:

```yaml
- id: emit_analysis_complete
  type: emit_event
  tier: light
  depends_on: [cross_module_dedup]
  inputs:
    event_name: RefactoringAnalysisCompletedEvent
    payload:
      event: RefactoringAnalysisCompletedEvent
      scopeId: "{{ trigger.scopeId }}"
      items_created: "{{ jobs.scan_codebase.output.items_created }}"
      duplicates_skipped: "{{ jobs.scan_codebase.output.duplicates_skipped }}"
      merged: "{{ jobs.cross_module_dedup.output.merged }}"
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- codebase-refactoring-analysis.contract.spec.ts`
Expected: PASS (4 cases).

- [ ] **Step 7: Guard against breaking the full seed contract**

Run: `npm run test --workspace=apps/api -- workflows.seed.contract.spec.ts`
Expected: PASS. If it fails because it asserts old `refactoring_findings`/`dedup_and_create` shape, update those assertions in that spec to the new shape (counts output + `cross_module_dedup`) and re-run.

- [ ] **Step 8: Commit**

```bash
git add seed/workflows/codebase_refactoring_analysis.workflow.yaml apps/api/src/database/seeds/workflow/codebase-refactoring-analysis.contract.spec.ts
git commit -m "feat(workflow): bound refactoring-analysis output to counts + cross-module dedup finalize"
```

---

### Task 4: Rewrite the coordinator and subagent prompts

**Files:**

- Modify: `seed/workflows/prompts/codebase-refactoring-analysis/coordinator-scan.md`
- Modify: `seed/workflows/prompts/codebase-refactoring-analysis/subagent-probe.md`
- Test: `apps/api/src/database/seeds/workflow/codebase-refactoring-analysis.contract.spec.ts` (extend)

**Interfaces:**

- Consumes: scoped vars `vars.analysis.refactoring_findings_cap`, `vars.analysis.refactoring_run_item_budget`, `vars.analysis.refactoring_rotation_lookback_runs` (Task 2); job graph (Task 3).
- Produces: subagent summary shape `{ scope_id, module_path, items_created, duplicates_skipped, outcome, created_items: [{ work_item_id, title, module_path }] }`; coordinator output `{ items_created, duplicates_skipped, created_items, scope_manifest:[{ scope_id, label, paths, outcome, created }] }`. The finalize prompt (Task 5) consumes `created_items` and `scope_manifest`.

- [ ] **Step 1: Add failing prompt-content assertions**

Append to `codebase-refactoring-analysis.contract.spec.ts`:

```ts
import { resolve as resolvePath } from "node:path";

const PROMPT_DIR = resolvePath(
  __dirname,
  "../../../../../../seed/workflows/prompts/codebase-refactoring-analysis",
);
const readPrompt = (name: string) =>
  readFileSync(resolvePath(PROMPT_DIR, name), "utf8");

describe("refactoring-analysis prompt contracts", () => {
  it("coordinator reads rotation files and the three scoped vars", () => {
    const p = readPrompt("coordinator-scan.md");
    expect(p).toContain("vars.analysis.refactoring_findings_cap");
    expect(p).toContain("vars.analysis.refactoring_run_item_budget");
    expect(p).toContain("vars.analysis.refactoring_rotation_lookback_runs");
    expect(p).toContain("docs/analysis/refactoring");
  });

  it("coordinator no longer synthesizes a findings array", () => {
    expect(readPrompt("coordinator-scan.md")).not.toContain(
      "refactoring_findings",
    );
  });

  it("subagent creates tickets and tags the module", () => {
    const p = readPrompt("subagent-probe.md");
    expect(p).toContain("kanban.work_item_create");
    expect(p).toContain("refactoring_module");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- codebase-refactoring-analysis.contract.spec.ts`
Expected: FAIL — current prompts don't reference the vars / `work_item_create` / `refactoring_module`, and the coordinator still mentions `refactoring_findings`.

- [ ] **Step 3: Rewrite the subagent prompt**

Replace the contents of `seed/workflows/prompts/codebase-refactoring-analysis/subagent-probe.md`:

```markdown
You are a Refactoring Analysis Subagent. Your scope, paths, and finding cap are
specified in your task brief.

Your job is to analyze the assigned module, create work items for the highest-
priority refactoring opportunities (deduplicated against existing items), and
return a compact summary. You do NOT return a full findings list.

---

## Context

- Project scope ID: Provided in your task brief
- Analysis scope and module paths: Provided in your task brief
- Finding cap (max work items to create): Provided in your task brief as `cap`

---

## Hard Rules

- Do not call ask_user_questions. This is an automated job.
- Use read-only tools (ls, read, bash read-only commands) for analysis. Do not
  write, edit, or commit any files.
- Create work items only with kanban.work_item_create. Dedup with
  kanban.list_work_items first.
- Never create more than `cap` work items.
- Return your summary via set_job_output exactly once.

---

## Step 1 — Explore the module

Use ls and read to understand structure, dependencies, and patterns. Look for:
SOLID violations, DRY violations, tight coupling / circular deps, missing
abstractions, dead code, cryptic naming, untested critical paths, and overly
complex functions (long functions, deep nesting, many parameters), plus
TODO/FIXME/HACK markers.

## Step 2 — Rank and keep the top findings

Assess each opportunity's severity (critical, high, medium, low). Keep only the
top `cap` by severity; break ties by the impact described in the rationale.
Discard the rest — they will resurface on a future run.

Severity guidelines:

- critical: Architectural issue causing bugs or blocking development
- high: Significant technical debt impacting productivity
- medium: Improvement that would meaningfully improve code quality
- low: Nice-to-have improvement, minor cleanup

## Step 3 — Deduplicate, then create work items

For each kept finding, call kanban.list_work_items (search the finding's title /
key terms; check all statuses). Skip the finding if a non-terminal item already
covers the same module + concern — count it as a duplicate.

For each novel finding, call kanban.work_item_create with:

- project_id: the project scope ID from your brief
- workItem:
  - title: `[Refactoring] <finding title>`
  - description: |
    Module: <module_path>
    Severity: <severity>

    <description>

    Rationale: <rationale>

    Identified by: codebase_refactoring_analysis (nightly scan)

  - scope: critical=large, high=medium, medium=small, low=small
  - priority: critical=urgent, high=high, medium=medium, low=low
  - metadata: { "refactoring_module": "<module_path>" }

## Step 4 — Return the summary

Call set_job_output exactly once with ONLY this summary (no full findings):

    {
      "scope_id": "<from task brief>",
      "module_path": "<primary module path for this scope>",
      "items_created": 2,
      "duplicates_skipped": 1,
      "outcome": "created",
      "created_items": [
        {
          "work_item_id": "wi-123",
          "title": "[Refactoring] Auth module violates SRP",
          "module_path": "apps/api/src/auth"
        }
      ]
    }

Set `outcome` to `created` if you created at least one item, otherwise `clean`.
```

- [ ] **Step 4: Rewrite the coordinator prompt**

Replace the contents of `seed/workflows/prompts/codebase-refactoring-analysis/coordinator-scan.md`:

```markdown
You are the Refactoring Analysis Coordinator for project scope {{trigger.scopeId}}.

Your job is to pick which modules to analyze this run (rotating across runs and
staying within a ticket budget), dispatch subagent probes that create their own
tickets, and return only aggregate counts. You do NOT collect or synthesize a
findings list.

---

## Context

- Scope ID: {{trigger.scopeId}}
- Repository root: `/workspace`. Always use paths relative to `/workspace`
  (e.g. `/workspace/apps`, `/workspace/packages`).
- Per-subagent finding cap: {{ vars.analysis.refactoring_findings_cap }}
- Run ticket budget (max work items this run): {{ vars.analysis.refactoring_run_item_budget }}
- Rotation lookback window (recent runs to consider): {{ vars.analysis.refactoring_rotation_lookback_runs }}

---

## Hard Rules

- Do not call ask_user_questions. This is an automated job.
- Do not call step_complete; use set_job_output instead.
- Use only spawn_subagent_async, wait_for_subagents, check_subagent_status for orchestration.
- Never dispatch more than three spawn_subagent_async calls in the same turn.
- If a spawn returns "Maximum concurrent subagents", wait before retrying.
- Never exceed the run ticket budget (see Step 3).

---

## Step 1 — Read recent coverage for rotation

List `/workspace/docs/analysis/refactoring/` (treat a missing directory as no
history). Take the most recent {{ vars.analysis.refactoring_rotation_lookback_runs }}
files (filenames sort chronologically) and read them. From each file's
`## Modules analyzed` section, record which modules were analyzed and how
recently. If the directory is empty, treat all modules as never-analyzed.

## Step 2 — Scan structure and select modules

Use ls on `/workspace` and read `/workspace/package.json` (or equivalent) to
identify modules/packages/apps. Group them into coherent analysis scopes (one
subagent each).

Select scopes in this priority order:

1. Modules absent from the lookback window (never / long-ago analyzed).
2. Then the stalest (least-recently analyzed) modules.
3. Within the same recency, prefer larger / more complex / higher-debt modules
   (size, coupling, test gaps, TODO/FIXME density).

Select only as many scopes as the run budget allows (see Step 3).

## Step 3 — Dispatch probes within the run budget

Track `remaining = {{ vars.analysis.refactoring_run_item_budget }}`.

For each selected scope, dispatch a subagent with spawn_subagent_async:

- task_prompt: the subagent brief below, with `cap` set to
  `min({{ vars.analysis.refactoring_findings_cap }}, remaining)`.
- agent_profile: investigation-subagent
- tools: ["read", "ls", "bash", "kanban.project_state", "kanban.list_work_items", "kanban.work_item_create"]
- Do not include a tier field; subagents run on heavy runtime.

Dispatch up to 3 independent scopes concurrently, then wait_for_subagents. After
each batch, subtract each summary's `items_created` from `remaining`. Stop
dispatching once `remaining <= 0`.

Subagent task brief template:

    You are a Refactoring Analysis Subagent for project <scope_id>.

    Project scope ID: <scope_id>
    Analysis scope: <label> (scope_id: <scope_id>)
    Repository root: /workspace (use paths relative to /workspace)
    Paths to analyze: <paths>
    cap: <min(per-subagent cap, remaining budget)>

    Analyze the assigned module, keep the top `cap` highest-severity refactoring
    findings, deduplicate them against existing work items, create work items for
    the novel ones (title prefix "[Refactoring]", and set metadata
    refactoring_module to the module path), and return a compact summary via
    set_job_output. Do not return a full findings list.

## Step 4 — Return aggregate counts

Sum the subagent summaries and call set_job_output with:

    {
      "items_created": 18,
      "duplicates_skipped": 5,
      "created_items": [
        { "work_item_id": "wi-123", "title": "[Refactoring] ...", "module_path": "apps/api/src/auth" }
      ],
      "scope_manifest": [
        {
          "scope_id": "auth",
          "label": "Authentication and Authorization",
          "paths": ["apps/api/src/auth"],
          "outcome": "created",
          "created": 2
        }
      ]
    }

`created_items` is the concatenation of every subagent's `created_items`.
`scope_manifest` has one entry per analyzed scope, carrying its `outcome`
(`created`/`clean`) and `created` count so the finalize step can record coverage.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- codebase-refactoring-analysis.contract.spec.ts`
Expected: PASS (all cases, including the new prompt-content ones).

- [ ] **Step 6: Commit**

```bash
git add seed/workflows/prompts/codebase-refactoring-analysis/coordinator-scan.md seed/workflows/prompts/codebase-refactoring-analysis/subagent-probe.md apps/api/src/database/seeds/workflow/codebase-refactoring-analysis.contract.spec.ts
git commit -m "feat(workflow): subagents cap+create tickets; coordinator rotates within run budget"
```

---

### Task 5: Add the finalize prompt and delete the old dedup prompt

**Files:**

- Create: `seed/workflows/prompts/codebase-refactoring-analysis/cross-module-dedup.md`
- Delete: `seed/workflows/prompts/codebase-refactoring-analysis/dedup-create.md`
- Test: `apps/api/src/database/seeds/workflow/codebase-refactoring-analysis.contract.spec.ts` (extend)

**Interfaces:**

- Consumes: `jobs.scan_codebase.output.created_items` and `jobs.scan_codebase.output.scope_manifest` (Task 4); the `{{ now }}` helper (Task 1); the workflow run id from runtime context.
- Produces: `set_job_output { merged: <integer> }`; a written `docs/analysis/refactoring/<date>-<run_id>.md` file.

- [ ] **Step 1: Add failing assertions for the finalize prompt**

Append to `codebase-refactoring-analysis.contract.spec.ts`:

```ts
import { existsSync } from "node:fs";

describe("finalize prompt contract", () => {
  it("cross-module-dedup prompt exists and writes the dated coverage file", () => {
    const p = readPrompt("cross-module-dedup.md");
    expect(p).toContain("{{ now }}");
    expect(p).toContain("docs/analysis/refactoring");
    expect(p).toContain("jobs.scan_codebase.output.created_items");
    expect(p).toContain("## Modules analyzed");
  });

  it("removes the old dedup-create prompt", () => {
    expect(existsSync(resolvePath(PROMPT_DIR, "dedup-create.md"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- codebase-refactoring-analysis.contract.spec.ts`
Expected: FAIL — `cross-module-dedup.md` does not exist yet (read throws / assertions fail) and `dedup-create.md` still exists.

- [ ] **Step 3: Create the finalize prompt**

Create `seed/workflows/prompts/codebase-refactoring-analysis/cross-module-dedup.md`:

```markdown
You are the Refactoring Analysis Finalizer for project scope {{trigger.scopeId}}.

Two jobs: (1) a light cross-module duplicate sweep over the tickets created this
run, and (2) write this run's coverage file. You do NOT re-analyze code.

---

## Context

- Scope ID: {{trigger.scopeId}}
- Current timestamp: {{ now }}
- Tickets created this run:

{{json jobs.scan_codebase.output.created_items}}

- Modules analyzed this run:

{{json jobs.scan_codebase.output.scope_manifest}}

---

## Hard Rules

- Do not call ask_user_questions. This is an automated job.
- Do not call spawn_subagent_async. Do not modify source code.
- Use only read, write, edit, kanban.list_work_items, kanban.work_item,
  kanban.work_item_transition_status, kanban.work_item_patch_metadata.
- Call set_job_output exactly once, then step_complete.

---

## Step 1 — Cross-module duplicate sweep

The created_items list above carries each ticket's id, title, and module_path.
Look for near-duplicate titles that describe the same concern across different
modules. For each duplicate pair, keep one ticket and resolve the other:

- Close the redundant ticket with kanban.work_item_transition_status (to a
  terminal status), and
- Annotate it via kanban.work_item_patch_metadata with `{ "duplicate_of": "<kept id>" }`.

Count how many tickets you closed as `merged`. If there are no cross-module
duplicates, `merged` is 0.

## Step 2 — Write this run's coverage file

Derive the date prefix from the timestamp above ({{ now }}) as `YYYY-MM-DD`. Use
your workflow run id (from your runtime context) as `<run_id>`.

Write (create directories if needed) the file
`/workspace/docs/analysis/refactoring/<date>-<run_id>.md` with EXACTLY this
structure (the `## Modules analyzed` list is parsed by the next run):

    # Refactoring Analysis — <date> (run <run_id>)

    Timestamp: {{ now }}

    ## Modules analyzed

    - <module_path> — <outcome> (<created count>): <comma-separated work item ids>

Produce one bullet per entry in scope_manifest. Use the scope's `paths[0]` (or
the most representative path) as `<module_path>`, its `outcome` and `created`
count, and the matching ids from created_items. For a `clean` module omit the
trailing `: ids`.

## Step 3 — Report

Call set_job_output with:

    { "merged": 0 }

Then call step_complete.
```

- [ ] **Step 4: Delete the old dedup-create prompt**

```bash
git rm seed/workflows/prompts/codebase-refactoring-analysis/dedup-create.md
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- codebase-refactoring-analysis.contract.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Full guard run + commit**

Run the workflow seed contract again to be safe:
`npm run test --workspace=apps/api -- workflows.seed.contract.spec.ts`
Expected: PASS.

```bash
git add seed/workflows/prompts/codebase-refactoring-analysis/cross-module-dedup.md apps/api/src/database/seeds/workflow/codebase-refactoring-analysis.contract.spec.ts
git commit -m "feat(workflow): add cross-module dedup finalize prompt + per-run coverage file"
```

---

### Task 6: Documentation

**Files:**

- Modify: `docs/guide/README.md` (or the workflow/orchestration deep-dive it links to) — whichever documents the nightly refactoring analysis or orchestration variables.

**Interfaces:** none (docs only).

- [ ] **Step 1: Find the doc references**

Run: `npm run lint:summary` is not needed here; instead search the guide:
Run: `grep -rn "codebase_refactoring_analysis\|refactoring analysis\|orchestration variable" docs/guide` (use the Grep tool).
Expected: identifies the section(s) describing the workflow and/or the scoped orchestration variables.

- [ ] **Step 2: Update the docs**

In the located section(s), document:

- The new behavior: subagents create their own tickets (top-N per module), coordinator rotates modules across runs within a per-run ticket budget, finalize does a cross-module dedup sweep and writes `docs/analysis/refactoring/<date>-<run>.md`.
- The three scoped variables and their defaults: `analysis.refactoring_findings_cap` (3), `analysis.refactoring_run_item_budget` (20), `analysis.refactoring_rotation_lookback_runs` (10), and that they are per-project overridable via the scoped-variable store.
- The new `now` handlebars helper and its determinism caveat (not for conditions/diffing).

If no existing section covers this workflow, add a short subsection under the orchestration/workflow area rather than creating a new top-level doc.

- [ ] **Step 3: Commit**

```bash
git add docs/guide
git commit -m "docs: document bounded refactoring analysis (caps, rotation, now helper)"
```

---

## Self-Review

**Spec coverage:**

- `now` helper (spec §1) → Task 1. ✔
- Three scoped vars (spec §2) → Task 2. ✔
- Subagent prompt: top-N cap, dedup, create, `refactoring_module`, summary shape (spec §3) → Task 4. ✔
- Coordinator: read lookback files, rotation, run-budget enforcement, counts output (spec §4) → Task 4. ✔
- Workflow YAML: scan_codebase contract+tools, rename to cross_module_dedup, finalize tools incl. write/edit, commit/emit rewiring (spec §5) → Task 3. ✔
- Finalize prompt incl. `{{ now }}` + per-run file + dedup sweep (spec §6) → Task 5. ✔
- Delete dedup-create.md, add cross-module-dedup.md, update prompt_file ref (spec §7) → Tasks 3 (ref) + 5 (files). ✔
- Per-run coverage file format / parse contract (spec "Cross-run coverage") → Task 5 prompt + Task 4 coordinator reader. ✔
- Testing: helper spec, vars contract, workflow contract (spec "Testing") → Tasks 1, 2, 3–5. ✔
- Docs (project CLAUDE.md requirement) → Task 6. ✔

**Placeholder scan:** No TBD/"handle edge cases"/"similar to" — every code/prompt block is complete. ✔

**Type/name consistency:** `cross_module_dedup` job + step id, prompt path `prompts/codebase-refactoring-analysis/cross-module-dedup.md`, output keys `items_created`/`duplicates_skipped`/`created_items`/`scope_manifest`/`merged`, and `refactoring_module` metadata key are used identically across Tasks 3–5. ✔

**Known runtime caveat (not a plan gap):** `commit_findings` is a `git_operation` (`commit_paths`) that has historically committed in the shared clone root; verify on the live re-run that the per-run coverage file is actually staged from the path the finalize step wrote to. Out of scope for this plan (no code change), but flag during verification.
