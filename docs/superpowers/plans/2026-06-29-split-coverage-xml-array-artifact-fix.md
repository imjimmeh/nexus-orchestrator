# Split-Coverage XML-Array Artifact Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `work_item_split_default` workflow from hard-failing when an agent on an XML-serializing provider (e.g. MiniMax-M3) emits a single-element array as `{ "item": "AC-1" }`, by coercing that artifact to a real array at the kanban MCP validation boundary where the array intent is unambiguous.

**Architecture:** Add a reusable, schema-driven `z.preprocess` helper (`xmlArrayArtifact`) in the kanban MCP shared schemas. It unwraps the sole-key `{ item: X }` XML-serialization artifact into an array **only where a field is declared as an array**, so it cannot mangle legitimate single-key objects. Apply it to `kanban.work_item_validate_split_coverage`'s array fields. Separately, make the split prompt resilient to an empty spec-file path so the agent fetches the work item via a kanban tool instead of reading an empty path.

**Tech Stack:** TypeScript, NestJS, Zod, Vitest (apps/kanban); YAML + Handlebars workflow seeds (seed/workflows).

## Background — Root Cause (run `d371fa98-38e8-4049-ac3b-ccc6672ccccf`)

The `split_work_item` agent job **succeeded** and persisted `set_job_output`. The downstream deterministic `validate_split_coverage` (`mcp_tool_call`) job then failed Zod validation at `apps/kanban/src/mcp/kanban-mcp.service.ts:51` with `-32000 Invalid arguments`, retried deterministically, and hard-failed the workflow — also stranding the parent (the `mark_parent_*` jobs depend on it).

The stored output proves the artifact:

```json
"child_ac_assignments": [
  { "ac_ids": { "item": "AC-1" }, "child_ref": "...-child-1" },   // single element → object  ✗
  { "ac_ids": { "item": "AC-2" }, "child_ref": "...-child-2" },   // single element → object  ✗
  { "ac_ids": ["AC-3","AC-4","AC-5"], "child_ref": "...-child-3" } // multi element → array   ✓
]
```

A **multi**-element XML array round-trips as `{ item: [...] }`; a **single**-element array round-trips as `{ item: <primitive> }`. The existing normalizer (`apps/api/src/workflow/xml-array-artifact.helpers.ts`) **deliberately** unwraps only `{ item: array|object }`, not `{ item: <primitive> }` (see `isArrayArtifact`, and the test `xml-array-artifact.helpers.spec.ts:63` "does not unwrap when item value is a primitive"). That exclusion exists because `{ item: "x" }` is structurally ambiguous at the API layer (collapsed single-element array vs. a real object). The **only** unambiguous disambiguator is a schema that declares the field as an array — which exists at the kanban MCP boundary. That is why the fix lives there, not in the API-side normalizer.

The agent's _inline_ Step-5 validation passed; only the redundant deterministic post-job re-validation, fed from the serialization-corrupted output, failed.

## Global Constraints

- **Strict lint policy:** Never suppress lint (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`, rule downgrades). Fix findings in code.
- **TDD:** Red → Green → Refactor for every change. Write the failing test first and confirm it fails before implementing.
- **Strong typing:** No `any`. The helper must be generic over the element schema and preserve inferred types.
- **Core/Kanban boundary:** This fix is kanban-owned. Do **not** add kanban knowledge to `apps/api` or `packages/core`. The API-side normalizer (`xml-array-artifact.helpers.ts`) is intentionally left unchanged.
- **No re-exports / single source of truth:** the helper lives once in `apps/kanban/src/mcp/tools/shared/schemas.ts` and is imported where needed.
- **Test runner:** `npm run test --workspace=apps/kanban -- <path-filter>` runs targeted Vitest files (the workspace `test` script is `vitest run --config vitest.config.ts`; a trailing positional path filters to that file).

---

## File Structure

- `apps/kanban/src/mcp/tools/shared/schemas.ts` — **Modify.** Add the exported `xmlArrayArtifact<T>(element: T)` helper alongside the existing `z.preprocess` helpers (`OptionalTrimmedProjectId`, `JsonObjectOrJsonString`, …).
- `apps/kanban/src/mcp/tools/shared/schemas.spec.ts` — **Create.** Unit tests for `xmlArrayArtifact` in isolation.
- `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.ts` — **Modify.** Wrap `parent_ac_ids`, `child_ac_assignments`, and the nested `ac_ids` with `xmlArrayArtifact`.
- `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts` — **Modify.** Add schema-level tests (`getDefinition().inputSchema.safeParse(...)`) proving the artifact is coerced and that legitimate inputs still pass.
- `seed/workflows/prompts/work-item-split-default/split.md` — **Modify.** Make Step 1 resilient to an empty spec-file path.
- `seed/workflows/work-item-split-default.workflow.yaml` — **Modify.** Grant `kanban.work_item` (read one work item) so the prompt's fallback fetch is permitted.

---

## Task 1: `xmlArrayArtifact` shared Zod helper

**Files:**

- Modify: `apps/kanban/src/mcp/tools/shared/schemas.ts`
- Test: `apps/kanban/src/mcp/tools/shared/schemas.spec.ts` (create)

**Interfaces:**

- Produces: `export function xmlArrayArtifact<T extends z.ZodTypeAny>(element: T): z.ZodEffects<z.ZodArray<T>, T["_output"][], unknown>` — a schema that accepts `{ item: X }` (sole-key) and yields `Array.isArray(X) ? X : [X]`, then validates each element against `element`; any other value passes straight through to `z.array(element)`.

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/mcp/tools/shared/schemas.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { xmlArrayArtifact } from "./schemas";

describe("xmlArrayArtifact", () => {
  const schema = xmlArrayArtifact(z.string().min(1));

  it("coerces a single-element XML artifact { item: <primitive> } into an array", () => {
    const parsed = schema.safeParse({ item: "AC-1" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(["AC-1"]);
    }
  });

  it("coerces a multi-element XML artifact { item: [...] } into the array", () => {
    const parsed = schema.safeParse({ item: ["AC-1", "AC-2"] });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(["AC-1", "AC-2"]);
    }
  });

  it("passes a plain array through unchanged", () => {
    const parsed = schema.safeParse(["AC-1", "AC-2", "AC-3"]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(["AC-1", "AC-2", "AC-3"]);
    }
  });

  it("does NOT unwrap a multi-key object (not the sole-key artifact shape)", () => {
    const parsed = schema.safeParse({ item: "AC-1", total: 1 });
    expect(parsed.success).toBe(false);
  });

  it("validates element constraints after coercion", () => {
    const parsed = schema.safeParse({ item: "" });
    expect(parsed.success).toBe(false);
  });

  it("works with object element schemas", () => {
    const objectSchema = xmlArrayArtifact(z.object({ ac_id: z.string() }));
    const parsed = objectSchema.safeParse({ item: { ac_id: "AC-1" } });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual([{ ac_id: "AC-1" }]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- src/mcp/tools/shared/schemas.spec.ts`
Expected: FAIL — `xmlArrayArtifact` is not exported from `./schemas` (TypeScript/import error).

- [ ] **Step 3: Write minimal implementation**

In `apps/kanban/src/mcp/tools/shared/schemas.ts`, add after the existing `import { z } ...` / `JsonValueSchema` imports (top of file), keeping it near the other `z.preprocess` helpers:

```ts
/**
 * Unwraps the XML-array serialization artifact some providers (notably
 * MiniMax via openai-completions) emit for array-typed tool arguments. A
 * multi-element array round-trips as `{ item: [...] }`; a single-element array
 * round-trips as `{ item: <element> }`. Both sole-key `item` forms are coerced
 * into a real array before the array schema validates.
 *
 * Driven by the declared array schema, so it is unambiguous: it only applies to
 * fields that are meant to be arrays and never touches legitimate single-key
 * objects whose schema is an object.
 */
export function xmlArrayArtifact<T extends z.ZodTypeAny>(element: T) {
  return z.preprocess((value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value as Record<string, unknown>);
      if (keys.length === 1 && keys[0] === "item") {
        const inner = (value as Record<string, unknown>).item;
        return Array.isArray(inner) ? inner : [inner];
      }
    }
    return value;
  }, z.array(element));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- src/mcp/tools/shared/schemas.spec.ts`
Expected: PASS (all 6 tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/mcp/tools/shared/schemas.ts apps/kanban/src/mcp/tools/shared/schemas.spec.ts
git commit -m "feat(kanban): add xmlArrayArtifact schema helper for single-element array coercion"
```

---

## Task 2: Apply `xmlArrayArtifact` to the split-coverage tool schema

**Files:**

- Modify: `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.ts:10-18`
- Test: `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts`

**Interfaces:**

- Consumes: `xmlArrayArtifact` from `../shared/schemas` (Task 1).
- Produces: `WorkItemValidateSplitCoverageTool.getDefinition().inputSchema` now accepts `parent_ac_ids`, `child_ac_assignments`, and each assignment's `ac_ids` in either array form or the `{ item: ... }` artifact form, coercing to arrays.

- [ ] **Step 1: Write the failing test**

Append to `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts` (inside the existing top-level `describe` block, after the last `it`):

```ts
describe("inputSchema XML-array artifact coercion", () => {
  const schema = tool.getDefinition().inputSchema;

  it("coerces single-element { item } ac_ids and validates coverage", () => {
    const parsed = schema.safeParse({
      project_id: "project-1",
      workItemId: "parent-1",
      parent_ac_ids: ["AC-1", "AC-2", "AC-3"],
      child_ac_assignments: [
        { child_ref: "child-1", ac_ids: { item: "AC-1" } },
        { child_ref: "child-2", ac_ids: { item: "AC-2" } },
        { child_ref: "child-3", ac_ids: ["AC-3"] },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.child_ac_assignments).toEqual([
        { child_ref: "child-1", ac_ids: ["AC-1"] },
        { child_ref: "child-2", ac_ids: ["AC-2"] },
        { child_ref: "child-3", ac_ids: ["AC-3"] },
      ]);
    }
  });

  it("coerces a single-element { item } parent_ac_ids", () => {
    const parsed = schema.safeParse({
      project_id: "project-1",
      workItemId: "parent-1",
      parent_ac_ids: { item: "AC-1" },
      child_ac_assignments: [{ child_ref: "child-1", ac_ids: ["AC-1"] }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.parent_ac_ids).toEqual(["AC-1"]);
    }
  });

  it("end-to-end: parsed artifact input passes coverage validation", async () => {
    const parsed = schema.safeParse({
      project_id: "project-1",
      workItemId: "parent-1",
      parent_ac_ids: ["AC-1", "AC-2"],
      child_ac_assignments: [
        { child_ref: "child-1", ac_ids: { item: "AC-1" } },
        { child_ref: "child-2", ac_ids: { item: "AC-2" } },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const result = await tool.execute(context, parsed.data);
      expect(result).toEqual({ ok: true, coveredCount: 2 });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts`
Expected: FAIL — `{ item: "AC-1" }` fails `z.array(z.string())`, so `parsed.success` is `false`.

- [ ] **Step 3: Write minimal implementation**

In `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.ts`, update the import and the two schemas:

```ts
import { ContextualWorkItemIdSchema } from "../shared/schemas";
import { resolveProjectIdFromToolContext } from "../shared/tool-context-resolvers";
import { xmlArrayArtifact } from "../shared/schemas";

const ChildAcAssignmentSchema = z.object({
  child_ref: z.string().optional(),
  ac_ids: xmlArrayArtifact(z.string().min(1)),
});

const WorkItemValidateSplitCoverageSchema = ContextualWorkItemIdSchema.extend({
  parent_ac_ids: xmlArrayArtifact(z.string().min(1)),
  child_ac_assignments: xmlArrayArtifact(ChildAcAssignmentSchema),
});
```

(If lint prefers a single import line, merge `xmlArrayArtifact` into the existing `from "../shared/schemas"` import rather than adding a second statement.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/kanban -- src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts`
Expected: PASS (existing tests + 3 new tests green).

- [ ] **Step 5: Lint the changed files**

Run: `npm run lint:kanban`
Expected: no errors. (If only kanban is desired and the script is repo-wide, the per-workspace lint still surfaces these files.)

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.ts apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts
git commit -m "fix(kanban): coerce XML-array artifacts in work_item_validate_split_coverage args"
```

---

## Task 3: Make the split prompt resilient to an empty spec-file path

**Files:**

- Modify: `seed/workflows/prompts/work-item-split-default/split.md:9-20`
- Modify: `seed/workflows/work-item-split-default.workflow.yaml` (tool grants)

**Interfaces:**

- Consumes: kanban read tool `kanban.work_item` (`apps/kanban/src/mcp/tools/read/work-item.tool.ts`), params `{ project_id, workItemId }`, "Read one kanban work item."

**Context:** In run `d371fa98`, `{{trigger.resource.metadata.workItemMarkdownPath}}` resolved to empty, so the prompt rendered `Read ` fully`` and the agent spent ~6 minutes guessing the work item from the filesystem. This task does not change the failure path; it removes the wasted-effort hazard.

- [ ] **Step 1: Update the prompt's Context + Step 1**

Replace lines 9-20 of `seed/workflows/prompts/work-item-split-default/split.md`:

```markdown
## Context

Scope ID: {{trigger.scopeId}}
Context ID: {{trigger.contextId}}
Spec file: {{trigger.resource.metadata.workItemMarkdownPath}}

---

## Step 1 - Read the spec file

Read `{{trigger.resource.metadata.workItemMarkdownPath}}` fully.
Understand the description and all acceptance criteria.
```

with:

````markdown
## Context

Scope ID: {{trigger.scopeId}}
Context ID: {{trigger.contextId}}
Spec file: {{trigger.resource.metadata.workItemMarkdownPath}}

---

## Step 1 - Read the work item

If a spec file path is shown above (the "Spec file" line is non-empty), read
`{{trigger.resource.metadata.workItemMarkdownPath}}` fully.

If the spec file path is empty, do NOT guess by searching the filesystem.
Instead fetch the work item directly with `kanban.work_item`:

```json
{ "project_id": "{{trigger.scopeId}}", "workItemId": "{{trigger.contextId}}" }
```

Either way, understand the description and all acceptance criteria before
designing the split.
````

- [ ] **Step 2: Grant `kanban.work_item` in the workflow tool policy**

In `seed/workflows/work-item-split-default.workflow.yaml`, add a grant for `kanban.work_item` in BOTH policy blocks (the top-level `permissions.tool_policy.rules` and the `split_work_item` job's `permissions.tool_policy.rules`), placing it next to the existing `kanban.work_item_validate_split_coverage` allow rule:

```yaml
- effect: allow
  tool: kanban.work_item
```

- [ ] **Step 3: Validate the seed**

Run: `npm run validate:seed-data`
Expected: PASS — the workflow YAML and prompt remain valid.

- [ ] **Step 4: Commit**

```bash
git add seed/workflows/prompts/work-item-split-default/split.md seed/workflows/work-item-split-default.workflow.yaml
git commit -m "fix(seed): split prompt fetches work item via kanban.work_item when spec path is empty"
```

---

## Deferred Follow-ups (not in this plan)

These are documented for the reviewer; they are intentionally **out of scope** because Task 2 prevents the observed failure and these involve broader design decisions:

1. **Redundant post-publish validation.** The agent already validates coverage inline (Step 5 of the prompt) before publishing. The deterministic `validate_split_coverage` job re-validates from `set_job_output` and is what broke here. Consider whether the post-job re-validation should be removed, or kept strictly as a tamper check. Decide separately — removing a safety net warrants its own review.
2. **Failure classification for deterministic tool-arg errors.** A `mcp_tool_call` arg-validation failure currently hard-fails the workflow and strands the parent (the `mark_parent_*` jobs depend on `validate_split_coverage`). Consider a classification/cleanup path so the parent is not left dangling. Lower priority once Task 2 lands.
3. **Adopt `xmlArrayArtifact` on other array-accepting kanban tools** that consume agent-produced output (e.g. `propose-work-items`, `work_item_subtask_validate_blueprint`). Audit and apply where the same artifact could appear.

---

## Deployment & Recovery (post-merge, manual)

Not code changes — operational steps after the above tasks merge:

- [ ] Rebuild and redeploy the kanban service so the new schema coercion is live: `docker compose up -d --build` (rebuilds `nexus-kanban`).
- [ ] Reseed so the updated `work-item-split-default` workflow/prompt and tool grants take effect.
- [ ] Re-trigger the split for the stranded parent work item `63dc40e4-b931-49c7-8616-883e604b678f` (run `d371fa98` cannot be auto-recovered — its stored `set_job_output` is the corrupted artifact). Confirm the new run reaches `mark_parent_blocked_awaiting_children`.

---

## Verification

- [ ] `npm run test --workspace=apps/kanban -- src/mcp/tools/shared/schemas.spec.ts` — green.
- [ ] `npm run test --workspace=apps/kanban -- src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts` — green (old + new).
- [ ] `npm run test:kanban` — full kanban suite green (no regressions).
- [ ] `npm run lint:kanban` — clean.
- [ ] `npm run validate:seed-data` — clean.
- [ ] Build check: `npm run build:kanban` succeeds.
