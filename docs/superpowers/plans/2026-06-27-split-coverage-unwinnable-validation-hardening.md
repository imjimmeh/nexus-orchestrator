# Split-Coverage Unwinnable-Validation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `work_item_split_default` workflow self-correct an invalid acceptance-criteria (AC) split in-loop, and make the decoupled coverage-validation guard recoverable instead of a terminal `human_required` failure.

**Architecture:** Four layers of defense for one root cause (run `324ce81e` failed terminally because the agent emitted overlapping AC assignments that only a downstream `mcp_tool_call` guard caught, with no feedback path back to the agent):

1. **In-loop self-validation** — the split agent calls `kanban.work_item_validate_split_coverage` itself and fixes violations _before_ publishing children or emitting output.
2. **Recoverable repair class** — a new `split_coverage_invalid` failure classification that re-dispatches the upstream producer agent job with the violation text as feedback, instead of routing to a human.
3. **Prompt hardening** — a worked partition example plus a forced pre-finish self-check.
4. **Side-effect ordering** — child specs are published only after coverage passes, so a failed split leaves no orphaned children.

**Tech Stack:** NestJS, TypeScript, Vitest, TypeORM, BullMQ, Handlebars-templated YAML workflows. Kanban MCP tool in `apps/kanban`. Repair engine in `apps/api/src/workflow/workflow-repair` + `apps/api/src/operations`.

## Global Constraints

- **API/core Kanban-neutrality:** `apps/api/src` and `packages/core/src` must remain Kanban-neutral. The new repair class and its classifier rule are **domain-neutral** — match on the generic validation-failure text shape, never on `kanban`/work-item identifiers. Do NOT add `kanban`, `split`, or work-item domain names to API/core code in a way that trips `nexus-boundaries/no-core-kanban-residue`. (The class id `split_coverage_invalid` is a neutral failure-mode name describing the evidence pattern, not a Kanban domain projection — but keep the classifier regex matching on the generic phrase "coverage validation failed", not on Kanban tool names.)
- **Strict lint policy:** Never suppress lint (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`). Fix in code.
- **NestJS build:** Use `nest build` / the workspace build scripts, not bare `tsc`.
- **TDD:** Red → Green → Refactor. One failing test first, minimal code to pass, then refactor.
- **Seed edits:** Changes to `seed/workflows/*.yaml` and `seed/workflows/prompts/**` require a reseed against the live stack to take effect (out of scope for this plan — note in handoff).
- **Repair-class tuple is `as const`:** adding a class touches `REPAIR_POLICY_CLASSES`, `REPAIR_POLICY_CONFIG`, and `doctorRepairActionIds` — all `as const`; keep them in sync or the build fails.

---

## File Structure

**Layer 1 + 3 + 4 (seed only, no app code):**

- Modify: `seed/workflows/work-item-split-default.workflow.yaml` — grant the validate tool to the agent job; reorder so publish happens after the agent self-validates.
- Modify: `seed/workflows/prompts/work-item-split-default/split.md` — add in-loop self-validation step, worked example, pre-finish checklist; move publish after validation.

**Layer 2 (repair engine, `apps/api`):**

- Modify: `apps/api/src/workflow/workflow-repair/failure-classification.types.ts` — add `'split_coverage_invalid'` to `REPAIR_POLICY_CLASSES`.
- Modify: `apps/api/src/workflow/workflow-repair/failure-classification-rules.ts` — add classifier rule in `decideClass()`.
- Modify: `apps/api/src/workflow/workflow-repair/repair-policy.config.ts` — add policy entry.
- Modify: `apps/api/src/operations/doctor.types.ts` — add `'redispatch_producer_job_with_feedback'` action id.
- Modify: `apps/api/src/operations/doctor-repair.constants.ts` — add the action description.
- Modify: `apps/api/src/operations/doctor-repair-executor.service.ts` — add the `executeAction` case.
- Modify: `apps/api/src/operations/doctor-workflow-repair.service.ts` — implement `redispatchProducerJobWithFeedback()`.
- Modify: `apps/api/src/workflow/workflow-repair/repair-executor-registry.service.ts` — map the policy action id → doctor action id.

**Tests:**

- `apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts`
- `apps/api/src/workflow/workflow-repair/repair-policy.service.spec.ts`
- `apps/api/src/operations/doctor-workflow-repair.service.spec.ts` (create if absent)
- `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts` (already exists — confirm coverage of duplicate/uncovered/unknown)

---

## Task 1: Reproduce — failing test for the validator's three violation shapes (characterization)

This locks the exact error-string shape the classifier (Task 4) must match. The validator already exists; this is a characterization test so Layer-2 regex stays pinned to real output.

**Files:**

- Test: `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts`

**Interfaces:**

- Consumes: `WorkItemValidateSplitCoverageTool.run(context, params)` from `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.ts:49`. Throws `BadRequestException` with message `Split coverage validation failed for <id>: <violations joined by "; ">`.
- Produces: the verified literal substring `acceptance criteria duplicated across children:` that Task 4's regex depends on.

- [ ] **Step 1: Read the existing spec to avoid duplication**

Run: open `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts`. If a duplicate-AC case already asserts the message substring, skip to Task 2 and only ADD any missing case below.

- [ ] **Step 2: Add/confirm the duplicate-AC characterization test**

```typescript
it("rejects an AC duplicated across children with the exact message shape", async () => {
  const tool = new WorkItemValidateSplitCoverageTool();
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;

  await expect(
    // @ts-expect-error access protected run for unit characterization
    tool.run(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      parent_ac_ids: ["AC-1", "AC-2"],
      child_ac_assignments: [
        { child_ref: "c1", ac_ids: ["AC-1", "AC-2"] },
        { child_ref: "c2", ac_ids: ["AC-1", "AC-2"] },
      ],
    }),
  ).rejects.toThrow(
    "Split coverage validation failed for wi-1: acceptance criteria duplicated across children: AC-1, AC-2",
  );
});
```

- [ ] **Step 3: Run the test to verify it passes (characterization — already-correct behavior)**

Run: `npm run test --workspace=apps/kanban -- work-item-validate-split-coverage`
Expected: PASS. (If it fails, the validator changed — STOP and re-baseline Task 4's regex.)

- [ ] **Step 4: Commit**

```bash
git add apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.spec.ts
git commit -m "test(kanban): pin split-coverage validation error-string shape"
```

---

## Task 2: Layer 1 + 4 — agent self-validates before publishing (seed + prompt)

Convert the terminal post-hoc validation into in-session self-correction. The agent calls the same validation tool it will later be checked by, fixes violations, and only then publishes child specs and emits output.

**Files:**

- Modify: `seed/workflows/work-item-split-default.workflow.yaml`
- Modify: `seed/workflows/prompts/work-item-split-default/split.md`

**Interfaces:**

- Consumes: `kanban.work_item_validate_split_coverage` MCP tool, params `{ project_id, workItemId, parent_ac_ids, child_ac_assignments }` (see `apps/kanban/src/mcp/tools/mutation/work-item-validate-split-coverage.tool.ts:15-18`).
- Produces: an agent job that emits `set_job_output` only after a passing self-validation; the downstream `validate_split_coverage` job becomes a near-no-op guard.

- [ ] **Step 1: Grant the validation tool to the agent job's tool_policy**

In `seed/workflows/work-item-split-default.workflow.yaml`, inside the `split_work_item` job's `permissions.tool_policy.rules` (the block at lines 65-96), add the validate tool and remove the accidental duplicate `edit` rule (lines 73-76 list `edit` twice). The job's rules should include:

```yaml
- effect: allow
  tool: read
- effect: allow
  tool: write
- effect: allow
  tool: edit
- effect: allow
  tool: bash
- effect: allow
  tool: query_memory
- effect: allow
  tool: remember
- effect: allow
  tool: step_complete
- effect: allow
  tool: kanban.publish_specs
- effect: allow
  tool: kanban.work_item_validate_split_coverage
- effect: allow
  tool: set_job_output
- effect: allow
  tool: ls
- effect: allow
  tool: get_todo_list
- effect: allow
  tool: manage_todo_list
- effect: deny
  tool: spawn_subagent_async
```

Also add the same `kanban.work_item_validate_split_coverage` allow rule to the workflow-level `permissions.tool_policy.rules` (lines 13-42) so the catalog (job ∩ workflow ∩ profile) does not strip it. Reference memory: `profile_ceiling_strips_workflow_tools` — the final catalog is the intersection, so the tool must be allowed at every layer AND granted by the `architect-agent` profile (verify the profile grants it; if not, that is a follow-up seed change to `architect-agent`).

- [ ] **Step 2: Rewrite split.md to validate before publishing**

In `seed/workflows/prompts/work-item-split-default/split.md`, replace the current Step 5 / Step 6 / "Coverage output" sequence (lines 58-92) so the order is: design → **self-validate** → publish → emit output. Replace from the "## Step 5 - Publish child specs" heading to end-of-file with:

````markdown
## Step 5 - Verify coverage BEFORE publishing

Before writing or publishing anything to the database, call
`kanban.work_item_validate_split_coverage` with:

```json
{
  "project_id": "{{trigger.scopeId}}",
  "workItemId": "{{trigger.contextId}}",
  "parent_ac_ids": ["AC-1", "AC-2", "..."],
  "child_ac_assignments": [
    { "child_ref": "<parent-id>-child-1", "ac_ids": ["AC-1", "AC-2"] },
    { "child_ref": "<parent-id>-child-2", "ac_ids": ["AC-3", "AC-4"] }
  ]
}
```

If it returns an error (e.g. "acceptance criteria duplicated across children",
"uncovered parent acceptance criteria", or "unknown acceptance criteria not on
the parent"), DO NOT proceed. Fix your `child_ac_assignments` so that **every
parent AC appears in exactly one child** and call the tool again. Repeat until
it returns `{ "ok": true }`. Only a passing validation may proceed.

## Step 6 - Write and publish child spec files

For each child, write a markdown file to `docs/work-items/<slug>.md` (front-matter
as in the template above), then call `kanban.publish_specs` with `project_id` to
reconcile them into the Kanban DB. This is a database-only operation with no git
side effects. Publishing happens ONLY after Step 5 passed.

## Step 7 - Emit output and complete

Call `set_job_output` with `data` as a plain object containing the SAME
`parent_ac_ids` and `child_ac_assignments` you validated in Step 5:

```json
{
  "split_outcome": "split_completed",
  "child_ids": ["<parent-id>-child-1", "<parent-id>-child-2"],
  "child_files": [
    "docs/work-items/slug-child-1.md",
    "docs/work-items/slug-child-2.md"
  ],
  "parent_ac_ids": ["AC-1", "AC-2", "AC-3", "AC-4"],
  "child_ac_assignments": [
    { "child_ref": "<parent-id>-child-1", "ac_ids": ["AC-1", "AC-2"] },
    { "child_ref": "<parent-id>-child-2", "ac_ids": ["AC-3", "AC-4"] }
  ]
}
```

Then call `step_complete` with summary:
"Split complete. N children created. Parent is now umbrella tracker."

### Pre-finish self-check (do this before set_job_output)

- [ ] Each parent AC id appears in exactly ONE child's `ac_ids` (no duplicates, none dropped).
- [ ] `kanban.work_item_validate_split_coverage` returned `{ "ok": true }` on these exact assignments.
- [ ] Every `child_ref` in `child_ac_assignments` matches an id in `child_ids`.
````

- [ ] **Step 3: Add the worked partition example to Step 3 (prompt hardening)**

In `split.md`, immediately after the AC partition rule (currently line 34-35), add:

```markdown
Worked example — parent has AC-1..AC-8, split into two children:

- child-1 `ac_ids`: ["AC-1","AC-2","AC-3","AC-4"]
- child-2 `ac_ids`: ["AC-5","AC-6","AC-7","AC-8"]
  WRONG (rejected): child-1 ["AC-1".."AC-7"], child-2 ["AC-1".."AC-8"] —
  the same AC may not appear in more than one child.
```

- [ ] **Step 4: Validate the seed YAML parses**

Run: `npm run validate:seed-data`
Expected: PASS (no schema/parse errors for `work_item_split_default`).

- [ ] **Step 5: Commit**

```bash
git add seed/workflows/work-item-split-default.workflow.yaml seed/workflows/prompts/work-item-split-default/split.md
git commit -m "feat(seed): split agent self-validates AC coverage before publishing children"
```

---

## Task 3: Layer 2a — add the `split_coverage_invalid` classification class

**Files:**

- Modify: `apps/api/src/workflow/workflow-repair/failure-classification.types.ts`
- Test: `apps/api/src/workflow/workflow-repair/failure-classification.types.spec.ts` (if present; else assert via Task 4's rules spec)

**Interfaces:**

- Produces: the literal `'split_coverage_invalid'` member of `RepairPolicyClass`, consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Add the class to the tuple**

In `apps/api/src/workflow/workflow-repair/failure-classification.types.ts`, add `'split_coverage_invalid'` to `REPAIR_POLICY_CLASSES` (the `as const` tuple at lines 4-16), e.g. after `'merge_dirty_worktree'`:

```typescript
  'merge_dirty_worktree',
  'split_coverage_invalid',
  'ambiguous_failure',
```

- [ ] **Step 2: Run the build to verify the union compiles**

Run: `npm run build:api`
Expected: PASS (no exhaustiveness errors yet — the next tasks fill `REPAIR_POLICY_CONFIG` and the registry, which will error until Task 5 is done; if `RepairPolicyConfig` requires all keys, expect a TS2741 here and complete Tasks 4-5 before re-building).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/workflow/workflow-repair/failure-classification.types.ts
git commit -m "feat(repair): register split_coverage_invalid repair class"
```

---

## Task 4: Layer 2b — classifier rule matching the coverage-validation failure

**Files:**

- Modify: `apps/api/src/workflow/workflow-repair/failure-classification-rules.ts`
- Test: `apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts`

**Interfaces:**

- Consumes: `RepairPolicyClass` (Task 3). The searchable text built by `buildSearchableText` (`failure-classification-rules.ts:209`) includes `evidence.errorMessage`, which carries `job_failed_after_retries: MCP tool invocation failed: ... Split coverage validation failed for <id>: acceptance criteria duplicated across children: AC-1...`.
- Produces: a `RuleDecision { class: 'split_coverage_invalid', confidence, reason }`.

- [ ] **Step 1: Write the failing test**

In `failure-classification-rules.spec.ts`, add:

```typescript
it("classifies split coverage validation failure as split_coverage_invalid", () => {
  const evidence = makeEvidence({
    errorMessage:
      "job_failed_after_retries: MCP tool invocation failed: MCP HTTP request failed (-32000): " +
      "Split coverage validation failed for 439b8258: acceptance criteria duplicated across children: AC-1, AC-2",
  });

  const decision = classifyFailureEvidence(evidence);

  expect(decision.class).toBe("split_coverage_invalid");
  expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
});
```

(Reuse the existing `makeEvidence`/evidence factory in this spec; if none exists, build a `NormalizedFailureEvidence` literal mirroring the other tests in the file.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- failure-classification-rules`
Expected: FAIL — currently classified as `tool_contract_mismatch` (the generic `tool.*(contract|schema|output)` rule at lines 61-71) or `ambiguous_failure`.

- [ ] **Step 3: Add the rule (ordered BEFORE the generic tool-contract rule)**

In `decideClass()` (`failure-classification-rules.ts`), insert this block **before** the `tool_contract_mismatch` rule at line 61 (so the specific coverage match wins over the generic "output/contract mismatch" catch):

```typescript
if (
  /coverage validation failed[\s\S]*?(?:duplicated across children|uncovered parent acceptance criteria|unknown acceptance criteria not on the parent)/i.test(
    searchableText,
  )
) {
  return {
    class: "split_coverage_invalid",
    confidence: 0.85,
    reason:
      "A producer job emitted output that failed downstream coverage validation; re-running the producer with the validation violation as feedback can resolve it.",
  };
}
```

(Domain-neutral: matches the generic phrase "coverage validation failed" + violation kinds, no Kanban identifiers.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- failure-classification-rules`
Expected: PASS. Re-run the whole spec file to confirm no other classification test regressed (the new rule is more specific and ordered first).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-repair/failure-classification-rules.ts apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts
git commit -m "feat(repair): classify coverage-validation failures as split_coverage_invalid"
```

---

## Task 5: Layer 2c — policy config + doctor action id + registry mapping

Wire the class to an allowed, non-human-required repair action and a doctor action id.

**Files:**

- Modify: `apps/api/src/workflow/workflow-repair/repair-policy.config.ts`
- Modify: `apps/api/src/operations/doctor.types.ts`
- Modify: `apps/api/src/operations/doctor-repair.constants.ts`
- Modify: `apps/api/src/workflow/workflow-repair/repair-executor-registry.service.ts`
- Test: `apps/api/src/workflow/workflow-repair/repair-policy.service.spec.ts`

**Interfaces:**

- Consumes: `RepairPolicyClass` (Task 3), `DoctorRepairActionId` (`doctor.types.ts:6-15`).
- Produces: policy action id `'doctor.workflow_run.redispatch_producer_with_feedback'` → doctor action id `'redispatch_producer_job_with_feedback'`.

- [ ] **Step 1: Write the failing policy test**

In `repair-policy.service.spec.ts`, add:

```typescript
it("routes split_coverage_invalid to an allowed (non-human) repair action", () => {
  const decision = service.applyPolicy({
    class: "split_coverage_invalid",
    confidence: 0.85,
    reason: "x",
    evidenceReferences: [],
  });

  expect(decision.eligibility).toBe("allow");
  expect(decision.allowedRepairActionIds).toContain(
    "doctor.workflow_run.redispatch_producer_with_feedback",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- repair-policy.service`
Expected: FAIL — no config entry for `split_coverage_invalid` (or eligibility resolves to `human_required`).

- [ ] **Step 3: Add the policy config entry**

In `repair-policy.config.ts`, add before `ambiguous_failure`:

```typescript
  split_coverage_invalid: {
    minimumConfidence: 0.8,
    allowedRepairActionIds: [
      'doctor.workflow_run.redispatch_producer_with_feedback',
    ],
    humanRequired: false,
    defaultExecutor: 'doctor',
    diagnosticLabel: 'Split coverage validation failed (recoverable)',
  },
```

- [ ] **Step 4: Add the doctor action id and description**

In `doctor.types.ts`, add `'redispatch_producer_job_with_feedback'` to `doctorRepairActionIds` (lines 6-13). In `doctor-repair.constants.ts`, add the matching description to `DOCTOR_REPAIR_ACTION_DESCRIPTIONS`:

```typescript
  redispatch_producer_job_with_feedback:
    'Re-dispatch the upstream producer job that generated output rejected by a downstream validation guard, injecting the validation violation as corrective feedback.',
```

- [ ] **Step 5: Map policy action id → doctor action id in the registry**

In `repair-executor-registry.service.ts`, add to `DOCTOR_PLAN_BY_POLICY_ACTION`:

```typescript
  'doctor.workflow_run.redispatch_producer_with_feedback':
    'redispatch_producer_job_with_feedback',
```

- [ ] **Step 6: Run the policy test + build**

Run: `npm run test --workspace=apps/api -- repair-policy.service && npm run build:api`
Expected: PASS, and the build's exhaustiveness checks over `REPAIR_POLICY_CONFIG` / `DOCTOR_REPAIR_ACTION_DESCRIPTIONS` now pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workflow/workflow-repair/repair-policy.config.ts apps/api/src/operations/doctor.types.ts apps/api/src/operations/doctor-repair.constants.ts apps/api/src/workflow/workflow-repair/repair-executor-registry.service.ts apps/api/src/workflow/workflow-repair/repair-policy.service.spec.ts
git commit -m "feat(repair): policy + doctor action wiring for split_coverage_invalid"
```

---

## Task 6: Layer 2d — executor re-dispatches the upstream producer job with feedback

The repair action re-runs the **execution job that the failed validation depended on** (generic: the failed job's first `execution`-type `depends_on`), passing the violation text via `retryFailedJobWithMessage`. When the producer re-runs and succeeds, the DAG resumes and re-validates fresh output.

**Files:**

- Modify: `apps/api/src/operations/doctor-repair-executor.service.ts`
- Modify: `apps/api/src/operations/doctor-workflow-repair.service.ts`
- Test: `apps/api/src/operations/doctor-workflow-repair.service.spec.ts` (create if absent)

**Interfaces:**

- Consumes: `WorkflowFailedJobRetryService.retryFailedJobWithMessage({ workflowRunId, failedJobId, retryPrompt })` (`apps/api/src/workflow/workflow-failed-job-retry.service.ts:26-33`) — note it re-runs the job named by `failedJobId` from the definition, NOT necessarily the originally-failed job. `WorkflowRunRepository.findById`, `WorkflowRepository.findByIdentifier`, `WorkflowParserService.parseWorkflow` to resolve the producer job's `depends_on`.
- The executor input is `DoctorRepairExecutionInput { action_id, dry_run, requested_by?, arguments }` (`doctor.types.ts:44-49`). `arguments` carries `{ workflowRunId, failedJobId, validationMessage }` — confirm the dispatch path populates these (see `workflow-repair-dispatch.service.ts` `dispatchResolvedPlan`; the doctor request event must forward the failed run's id, failed job id, and sanitized failure message into `arguments`). If the current dispatch does not forward `validationMessage`, add it there as part of this task.
- Produces: a `RepairOutcome { status: 'succeeded' | 'failed', message, changes, evidence }` and, as a side effect, a re-queued producer agent job.

- [ ] **Step 1: Write the failing test**

In `doctor-workflow-repair.service.spec.ts`, add (mock `WorkflowFailedJobRetryService`, `WorkflowRunRepository`, `WorkflowRepository`, `WorkflowParserService`):

```typescript
it("redispatches the producer execution job that the failed validation depended on, with feedback", async () => {
  runRepo.findById.mockResolvedValue({
    id: "run-1",
    workflow_id: "work_item_split_default",
    status: WorkflowStatus.FAILED,
  });
  workflowRepo.findByIdentifier.mockResolvedValue({ yaml_definition: "yaml" });
  parser.parseWorkflow.mockReturnValue({
    jobs: [
      { id: "split_work_item", type: "execution" },
      {
        id: "validate_split_coverage",
        type: "mcp_tool_call",
        depends_on: ["split_work_item"],
      },
    ],
  });
  retryService.retryFailedJobWithMessage.mockResolvedValue({
    retried: true,
    failedJobId: "split_work_item",
  });

  const outcome = await service.redispatchProducerJobWithFeedback({
    action_id: "redispatch_producer_job_with_feedback",
    dry_run: false,
    arguments: {
      workflowRunId: "run-1",
      failedJobId: "validate_split_coverage",
      validationMessage:
        "Split coverage validation failed for wi-1: acceptance criteria duplicated across children: AC-1",
    },
  });

  expect(outcome.status).toBe("succeeded");
  expect(retryService.retryFailedJobWithMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      workflowRunId: "run-1",
      failedJobId: "split_work_item",
      retryPrompt: expect.stringContaining("coverage validation failed"),
    }),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/api -- doctor-workflow-repair.service`
Expected: FAIL — `redispatchProducerJobWithFeedback` is not defined.

- [ ] **Step 3: Implement the method**

In `doctor-workflow-repair.service.ts`, add (inject `WorkflowFailedJobRetryService`, `WorkflowRunRepository`, `WorkflowRepository`, `WorkflowParserService` if not already present — follow the constructor-injection pattern already in the file):

```typescript
async redispatchProducerJobWithFeedback(
  input: DoctorRepairExecutionInput,
): Promise<RepairOutcome> {
  const workflowRunId = readString(input.arguments.workflowRunId);
  const failedJobId = readString(input.arguments.failedJobId);
  const validationMessage =
    readString(input.arguments.validationMessage) ??
    'Downstream validation rejected the produced output.';

  if (!workflowRunId || !failedJobId) {
    return {
      status: 'failed',
      message: 'Missing workflowRunId or failedJobId for producer re-dispatch.',
      changes: {},
      evidence: { arguments: input.arguments },
    };
  }

  const run = await this.runRepo.findById(workflowRunId);
  if (!run) {
    return { status: 'failed', message: `Run ${workflowRunId} not found.`, changes: {}, evidence: {} };
  }

  const workflow = await this.workflowRepo.findByIdentifier(run.workflow_id, {
    includeInactive: true,
  });
  const definition = workflow
    ? this.parser.parseWorkflow(workflow.yaml_definition)
    : undefined;
  const failedJob = definition?.jobs?.find((j) => j.id === failedJobId);
  const producerJobId = failedJob?.depends_on?.find((depId) =>
    definition?.jobs?.some((j) => j.id === depId && j.type === 'execution'),
  );

  if (!producerJobId) {
    return {
      status: 'failed',
      message: `No upstream execution producer found for ${failedJobId}; cannot auto-correct.`,
      changes: {},
      evidence: { failedJobId },
    };
  }

  if (input.dry_run) {
    return {
      status: 'succeeded',
      message: `Dry run: would re-dispatch producer ${producerJobId} with validation feedback.`,
      changes: { producerJobId },
      evidence: { validationMessage },
    };
  }

  const retryPrompt =
    `Your previous output was rejected by downstream validation:\n\n${validationMessage}\n\n` +
    `Re-run this job and correct the output so it passes. Each acceptance criterion must be ` +
    `assigned to exactly one child (no duplication, none dropped).`;

  const result = await this.failedJobRetryService.retryFailedJobWithMessage({
    workflowRunId,
    failedJobId: producerJobId,
    retryPrompt,
  });

  if (!result) {
    return {
      status: 'failed',
      message: `Re-dispatch of producer ${producerJobId} was rejected (run not in FAILED state or job missing).`,
      changes: { producerJobId },
      evidence: {},
    };
  }

  return {
    status: 'succeeded',
    message: `Re-dispatched producer job ${producerJobId} with validation feedback.`,
    changes: { producerJobId },
    evidence: { validationMessage },
  };
}
```

(Import `readString` from `@nexus/core` as in `workflow-failed-job-retry.service.ts:2`.)

- [ ] **Step 4: Wire the executor case**

In `doctor-repair-executor.service.ts`, add to the `executeAction` switch (lines 116-131):

```typescript
      case 'redispatch_producer_job_with_feedback':
        return this.workflowRepair.redispatchProducerJobWithFeedback(input);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/api -- doctor-workflow-repair.service`
Expected: PASS.

- [ ] **Step 6: Confirm the dispatch path forwards `validationMessage`**

Read `apps/api/src/workflow/workflow-repair/workflow-repair-dispatch.service.ts` `dispatchResolvedPlan` and the doctor-requested event payload. Verify the doctor execution `arguments` include `workflowRunId`, `failedJobId`, and the sanitized failure message as `validationMessage`. If `validationMessage` is not currently forwarded, add it (the failure reason is already available on the run / `last_failure`). Add a focused test asserting the argument is forwarded.

- [ ] **Step 7: Run the API build + the repair specs**

Run: `npm run build:api && npm run test --workspace=apps/api -- workflow-repair`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/operations/doctor-workflow-repair.service.ts apps/api/src/operations/doctor-repair-executor.service.ts apps/api/src/operations/doctor-workflow-repair.service.spec.ts apps/api/src/workflow/workflow-repair/workflow-repair-dispatch.service.ts
git commit -m "feat(repair): re-dispatch upstream producer job with validation feedback"
```

---

## Task 7: Integration — end-to-end recoverable-failure path

Prove that a coverage-validation failure now classifies as `split_coverage_invalid`, dispatches (when repair delegation is enabled), and re-queues the producer job — instead of terminating `human_required`.

**Files:**

- Test: `apps/api/src/workflow/workflow-repair/workflow-failure-classification.integration.spec.ts`

**Interfaces:**

- Consumes: the full classify → policy → dispatch chain (`WorkflowFailureClassificationService`, `RepairPolicyService`, `WorkflowRepairDispatchService`).

- [ ] **Step 1: Write the failing integration test**

Add a case feeding a synthetic run-failure with the coverage-validation `last_failure` reason and asserting: classification `class === 'split_coverage_invalid'`, `eligibility === 'allow'`, and `allowedRepairActionIds` contains `doctor.workflow_run.redispatch_producer_with_feedback`. Mirror the existing cases in this spec (lines 9-99).

- [ ] **Step 2: Run it to verify it fails, then passes after wiring**

Run: `npm run test --workspace=apps/api -- workflow-failure-classification.integration`
Expected: PASS once Tasks 3-6 are in place.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/workflow/workflow-repair/workflow-failure-classification.integration.spec.ts
git commit -m "test(repair): integration coverage for split_coverage_invalid recovery"
```

---

## Task 8: Docs + final verification

**Files:**

- Modify: `docs/orchestration/workflow-catalog.md` (the `work_item_split_default` entry) — note the in-loop self-validation step.
- Modify: `docs/kanban-workflows-documentation.md` if it describes the split flow.
- Modify: `docs/guide/` — add a short note under the repair/failure-classification section that `split_coverage_invalid` is a recoverable class that re-dispatches the producer with feedback (keep API/core docs Kanban-neutral).

- [ ] **Step 1: Update the docs above to reflect the new order and repair class.**

- [ ] **Step 2: Full gate — lint + targeted tests + builds**

Run:

```bash
npm run build --workspace=packages/core
npm run build:api
npm run lint:api
npm run test --workspace=apps/api -- workflow-repair operations/doctor-workflow-repair failure-classification repair-policy
npm run test --workspace=apps/kanban -- work-item-validate-split-coverage
npm run validate:seed-data
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: document split self-validation and split_coverage_invalid repair class"
```

---

## Out of scope / handoff notes

- **Reseed + redeploy required:** Task 2's seed/prompt changes only take effect after a reseed against the live stack; Tasks 3-7 require a `nexus-api` rebuild + redeploy. Neither is part of this plan.
- **Recover run `324ce81e`:** the stuck/failed run for work-item `439b8258` should be re-triggered after deploy; verify the parent did not leave orphaned `-child-1` / `-child-2` specs in the Kanban DB (the pre-fix run published children before failing). If orphans exist, clean them before re-running.
- **`architect-agent` profile grant:** confirm the profile's tool ceiling allows `kanban.work_item_validate_split_coverage`; if not, add it to the profile seed (intersection rule — see memory `profile_ceiling_strips_workflow_tools`).
- **Minor, non-fatal (no fix here):** the agent hit "Only one todo item can be in-progress at a time" (manage_todo_list misuse) and two `ENOENT` path guesses it recovered from — noise, not failure causes.

## Self-Review

- **Spec coverage:** Layer 1 (Task 2 self-validate + reorder), Layer 2 (Tasks 3-7 recoverable repair class), Layer 3 (Task 2 worked example + checklist), Layer 4 (Task 2 publish-after-validate ordering). All four user-selected fixes are covered.
- **Placeholder scan:** all code steps contain concrete code; the one investigation step (Task 6 Step 6) names the exact file and the exact argument to verify/add.
- **Type consistency:** `split_coverage_invalid` (class), `doctor.workflow_run.redispatch_producer_with_feedback` (policy action id), `redispatch_producer_job_with_feedback` (doctor action id + method `redispatchProducerJobWithFeedback`) are used consistently across Tasks 3-7. `retryFailedJobWithMessage` signature matches `workflow-failed-job-retry.service.ts:26`.
