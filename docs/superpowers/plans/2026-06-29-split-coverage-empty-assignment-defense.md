# Split-Coverage Empty-Assignment Defense Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `work_item_split_default` workflow from hard-failing (`human_required`, no auto-repair) when the split agent emits a malformed/empty `child_ac_assignments` such as `[""]`, by validating the shape at the producing job, giving the agent immediate in-turn feedback, and routing any schema-rejection that still reaches the downstream validation job into the existing bounded auto-repair.

**Architecture:** Four-layer defense in depth. (A) Tighten the `split_work_item` output contract from a shallow `array` to a deep `array<object{…}>` schema so `[""]` is caught by the engine's existing output-contract retry. (B) Make `set_job_output` validate the _types_ of the fields it is given against the job's output contract and reject malformed values immediately with field-level feedback, instead of silently returning `{ok:true}`. (C) Extend the failure classifier so a `-32000 Invalid arguments` rejection from `kanban.work_item_validate_split_coverage` is classified `split_coverage_invalid` (routing into the already-wired, already-bounded `redispatch_producer_with_feedback` repair) instead of `ambiguous_failure`/`human_required`. (D) Harden the split agent prompt against placeholder/empty arrays and the `set_job_output` false-positive, plus a `workspace_root` hint for `publish_specs`.

**Tech Stack:** NestJS (apps/api), TypeScript, Vitest, Zod, Handlebars-templated YAML workflow seeds, `@nexus/core` shared types.

## Global Constraints

- Strict lint policy — no `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- TDD (Red-Green-Refactor): write the failing test first, watch it fail, then minimal implementation.
- `apps/api/src` and `packages/core/src` must remain Kanban-neutral. All changes in Part A's API code use neutral language; Kanban-domain knowledge stays in the seed YAML / prompt (Tasks 1, 6) and `apps/kanban` (untouched here).
- NestJS apps build with `nest build`, not `tsc`. Run the API unit suite with `npm run test:api`; a single file with `npm run test --workspace=apps/api -- run <path>`.
- Do not change the kanban MCP tool schema (`apps/kanban/.../work-item-validate-split-coverage.tool.ts`) — `xmlArrayArtifact` is already applied there and is correct; it cannot reconstruct genuinely-absent data, which is what this plan prevents upstream.
- Reseeding is required after any `seed/workflows/**` change for the running stack to pick it up; that is a deploy step, out of scope for these tasks (noted in the final checklist).

---

## Background (why each layer exists)

Runs `e09fa224` and `5c2aa465` (both `work_item_split_default`, project `458935f0`, model MiniMax-M3) both hard-failed with:

```
job_failed_after_retries: MCP HTTP request failed (-32000):
Invalid arguments for kanban MCP tool kanban.work_item_validate_split_coverage
```

The split agent validated correct assignments interactively (`coveredCount: 8`), then its final `set_job_output` stored `child_ac_assignments: [""]` — a placeholder empty array. Its own reasoning: _"I left the array empty… set_job_output is returning ok:true without echoing the data — that's its design. Let me just complete the step."_

Failure chain:

- **L1** `split_work_item.output_contract.types.child_ac_assignments: array` is validated only by `Array.isArray()` (`apps/api/src/workflow/workflow-output-contract-type.helpers.ts:88-89`), so `[""]` passes → `job.output_contract.satisfied` → job completes.
- **L2** `set_job_output` persists blindly and returns `{ok:true}` (`apps/api/src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.ts`; controller hardcodes `{ ok: true }`). The model reads this as success.
- **L3** `validate_split_coverage` (mcp_tool_call) forwards `[""]` to the kanban tool → `-32000 Invalid arguments`.
- **L4** Classifier `apps/api/src/workflow/workflow-repair/failure-classification-rules.ts` matches the message against `SPLIT_COVERAGE_INVALID_PATTERN` (only `coverage validation failed … duplicated/uncovered/unknown`) — the schema-rejection message matches neither that nor `tool_contract_mismatch`, so it falls through to `ambiguous_failure` → `human_required`.

Already-present machinery this plan reuses:

- The output-contract type engine already supports deep schemas and recurses (`findOutputContractTypeMismatch`, helpers.ts:113-164); the workflow validator already accepts the nested form (`isOutputContractTypeSchema` via `workflow-validation.job-rules.ts:240-280`). **No parser change needed for Task 1.**
- `split_coverage_invalid` repair class is wired to `doctor.workflow_run.redispatch_producer_with_feedback` (`repair-policy.config.ts:75-83`), which re-runs the upstream `execution` producer with feedback (`apps/api/src/operations/doctor-workflow-repair.service.ts:40-112`) and is bounded by `WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING` (`workflow-repair-dispatch.service.ts:73-92`, `retry_limit_exceeded`). **Task 5 only extends the classifier matcher; the recovery + bound already exist.**

---

## File Structure

| File                                                                                     | Responsibility                                                                               | Task  |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----- |
| `seed/workflows/work-item-split-default.workflow.yaml`                                   | Deep output-contract typing for `split_work_item`                                            | 1     |
| `apps/api/src/workflow/workflow-output-contract-type.helpers.spec.ts`                    | Unit proof that `[""]` fails the nested schema and a well-formed array passes                | 1     |
| `apps/api/src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.ts`      | Type-validate provided fields against the job contract; reject with feedback                 | 2,3,4 |
| `apps/api/src/workflow/workflow-runtime/job-output-contract-resolver.service.ts`         | Resolve a run's job `output_contract` from the persisted workflow definition                 | 2     |
| `apps/api/src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.spec.ts` | Unit tests for the new rejection behavior                                                    | 3,4   |
| `apps/api/src/workflow/workflow-repair/failure-classification-rules.ts`                  | Classify `-32000 Invalid arguments` from the split-coverage tool as `split_coverage_invalid` | 5     |
| `apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts`             | Unit tests for the extended matcher                                                          | 5     |
| `seed/workflows/prompts/work-item-split-default/split.md`                                | Prompt hardening against empty arrays + `{ok:true}` false-positive + `workspace_root` hint   | 6     |

---

## Task 1: Deep output-contract typing for `split_work_item` (Fix A)

Tighten the producing job's contract so a degenerate `child_ac_assignments` like `[""]` is an _invalid type_ (not a satisfied `array`), engaging the engine's existing output-contract retry (`StepRequiredToolRetryService`) which re-prompts the agent with the job's `retry_prompt` before the downstream validation job can run.

**Files:**

- Modify: `seed/workflows/work-item-split-default.workflow.yaml:58-66`
- Test: `apps/api/src/workflow/workflow-output-contract-type.helpers.spec.ts` (create if absent)

**Interfaces:**

- Consumes: `findOutputContractTypeMismatch(value, schema, path)` and `isOutputContractTypeSchema(value)` from `apps/api/src/workflow/workflow-output-contract-type.helpers.ts` (existing, unchanged).
- Produces: a deep `OutputContractTypeSchema` literal embedded in the seed; no new code symbols.

- [ ] **Step 1: Write the failing test**

Create/extend `apps/api/src/workflow/workflow-output-contract-type.helpers.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { OutputContractTypeSchema } from "@nexus/core";
import {
  findOutputContractTypeMismatch,
  isOutputContractTypeSchema,
} from "./workflow-output-contract-type.helpers";

// Mirrors the deep schema applied to child_ac_assignments in
// seed/workflows/work-item-split-default.workflow.yaml.
const CHILD_AC_ASSIGNMENTS_SCHEMA: OutputContractTypeSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      child_ref: "string",
      ac_ids: { type: "array", items: "string" },
    },
  },
};

describe("child_ac_assignments deep output-contract schema", () => {
  it("is accepted by the workflow output-contract validator", () => {
    expect(isOutputContractTypeSchema(CHILD_AC_ASSIGNMENTS_SCHEMA)).toBe(true);
  });

  it('rejects the degenerate placeholder array [""]', () => {
    const mismatch = findOutputContractTypeMismatch(
      [""],
      CHILD_AC_ASSIGNMENTS_SCHEMA,
      "child_ac_assignments",
    );
    expect(mismatch).toBeDefined();
    expect(mismatch?.field).toBe("child_ac_assignments[0]");
  });

  it("accepts a well-formed array of assignment objects", () => {
    const mismatch = findOutputContractTypeMismatch(
      [
        { child_ref: "p-child-1", ac_ids: ["AC-1", "AC-2"] },
        { child_ref: "p-child-2", ac_ids: ["AC-3"] },
      ],
      CHILD_AC_ASSIGNMENTS_SCHEMA,
      "child_ac_assignments",
    );
    expect(mismatch).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-output-contract-type.helpers.spec.ts`
Expected: FAIL on the new `describe` block only if the spec file is new (file-not-found resolves once created); the three assertions must PASS against the _unchanged_ helper because the helper already supports deep schemas. **This test guards the schema literal we are about to paste into the seed** — if any assertion fails, the schema literal is wrong; fix the literal, not the helper.

> Note: this is a characterization test for the schema literal, not a Red for new production code — the production change in this task is the seed YAML. Proceed to Step 3 once all three assertions pass.

- [ ] **Step 3: Apply the deep contract to the seed**

In `seed/workflows/work-item-split-default.workflow.yaml`, replace the `types` block (lines 58-63) and raise `max_retries` (line 64) so the agent gets two corrective attempts:

```yaml
      types:
        split_outcome: string
        child_ids:
          type: array
          items: string
        child_files:
          type: array
          items: string
        parent_ac_ids:
          type: array
          items: string
        child_ac_assignments:
          type: array
          items:
            type: object
            properties:
              child_ref: string
              ac_ids:
                type: array
                items: string
    max_retries: 2
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-output-contract-type.helpers.spec.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Verify the seed still parses and validates**

Run: `npm run test --workspace=apps/api -- run src/workflow/testing/seed-workflows.dry-run.spec.ts`
Expected: PASS — the dry-run/seed-validation suite parses every seed workflow including the modified one; a malformed contract would surface here.

- [ ] **Step 6: Commit**

```bash
git add seed/workflows/work-item-split-default.workflow.yaml apps/api/src/workflow/workflow-output-contract-type.helpers.spec.ts
git commit -m "fix(split): deep output-contract typing for child_ac_assignments

A placeholder child_ac_assignments like [\"\"] previously satisfied the
shallow 'array' type and completed the split job, then crashed the
downstream validate_split_coverage MCP call with -32000. Tighten the
contract to array<object{child_ref,ac_ids:array<string>}> so the engine's
output-contract retry re-prompts the agent before completion."
```

---

## Task 2: Resolve a run's job output contract for `set_job_output` (Fix B, scaffolding)

`set_job_output` currently has no access to the job's `output_contract`. Add a small resolver that loads the run's workflow definition and returns the target job's contract, so Task 3 can validate against it. This mirrors how `DoctorWorkflowRepairService` resolves a job from the definition (`runRepo` → `workflowRepo` → `WorkflowParserService`).

**Files:**

- Create: `apps/api/src/workflow/workflow-runtime/job-output-contract-resolver.service.ts`
- Create: `apps/api/src/workflow/workflow-runtime/job-output-contract-resolver.service.spec.ts`
- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts` (register the provider — confirm the exact module that declares `WorkflowRuntimeSetJobOutputService` and add the new provider there)

**Interfaces:**

- Consumes: `WorkflowRunRepository.findById(runId)` → `{ workflow_id }`; `WorkflowRepository.findByIdentifier(workflowId, { includeInactive: true })` → `{ yaml_definition }`; `WorkflowParserService.parseWorkflow(yaml)` → `{ jobs: IJob[] }`. All existing.
- Produces: `JobOutputContractResolverService.resolveContract(workflowRunId: string, jobId: string): Promise<OutputContract | null>` — returns the job's `output_contract` or `null` when the run, workflow, job, or contract is absent.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-runtime/job-output-contract-resolver.service.spec.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { JobOutputContractResolverService } from "./job-output-contract-resolver.service";

function build(overrides?: {
  run?: unknown;
  workflow?: unknown;
  parsed?: unknown;
}) {
  const runRepo = { findById: vi.fn().mockResolvedValue(overrides?.run) };
  const workflowRepo = {
    findByIdentifier: vi.fn().mockResolvedValue(overrides?.workflow),
  };
  const parser = {
    parseWorkflow: vi.fn().mockReturnValue(overrides?.parsed),
  };
  const service = new JobOutputContractResolverService(
    runRepo as never,
    workflowRepo as never,
    parser as never,
  );
  return { service, runRepo, workflowRepo, parser };
}

describe("JobOutputContractResolverService", () => {
  it("returns the output_contract for the named job", async () => {
    const contract = { required: ["x"], types: { x: "array" } };
    const { service } = build({
      run: { workflow_id: "wf-1" },
      workflow: { yaml_definition: "yaml" },
      parsed: { jobs: [{ id: "job-a", output_contract: contract }] },
    });
    await expect(service.resolveContract("run-1", "job-a")).resolves.toEqual(
      contract,
    );
  });

  it("returns null when the run is missing", async () => {
    const { service } = build({ run: null });
    await expect(service.resolveContract("run-1", "job-a")).resolves.toBeNull();
  });

  it("returns null when the job has no contract", async () => {
    const { service } = build({
      run: { workflow_id: "wf-1" },
      workflow: { yaml_definition: "yaml" },
      parsed: { jobs: [{ id: "job-a" }] },
    });
    await expect(service.resolveContract("run-1", "job-a")).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-runtime/job-output-contract-resolver.service.spec.ts`
Expected: FAIL with "Cannot find module './job-output-contract-resolver.service'".

- [ ] **Step 3: Implement the resolver**

Create `apps/api/src/workflow/workflow-runtime/job-output-contract-resolver.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import type { OutputContract } from "@nexus/core";
import { WorkflowRunRepository } from "../database/repositories/workflow-run.repository";
import { WorkflowRepository } from "../database/repositories/workflow.repository";
import { WorkflowParserService } from "../workflow-parser.service";

/**
 * Resolves the output_contract declared for a job in a run's workflow
 * definition. Used by set_job_output to validate submitted data against the
 * declared types at submit time, so the agent receives immediate feedback
 * instead of a false-positive {ok:true}.
 */
@Injectable()
export class JobOutputContractResolverService {
  private readonly logger = new Logger(JobOutputContractResolverService.name);

  constructor(
    private readonly runRepo: WorkflowRunRepository,
    private readonly workflowRepo: WorkflowRepository,
    private readonly parser: WorkflowParserService,
  ) {}

  async resolveContract(
    workflowRunId: string,
    jobId: string,
  ): Promise<OutputContract | null> {
    try {
      const run = await this.runRepo.findById(workflowRunId);
      if (!run) {
        return null;
      }
      const workflow = await this.workflowRepo.findByIdentifier(
        run.workflow_id,
        { includeInactive: true },
      );
      if (!workflow) {
        return null;
      }
      const definition = this.parser.parseWorkflow(workflow.yaml_definition);
      const job = definition.jobs?.find((candidate) => candidate.id === jobId);
      return job?.output_contract ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not resolve output_contract for run ${workflowRunId} job ${jobId}: ${message}`,
      );
      return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-runtime/job-output-contract-resolver.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the provider**

Add `JobOutputContractResolverService` to the `providers` array of the NestJS module that declares `WorkflowRuntimeSetJobOutputService`. Find it first:

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-runtime/job-output-contract-resolver.service.spec.ts` (already green) then locate the module:

```bash
grep -rl "WorkflowRuntimeSetJobOutputService" apps/api/src --include="*.module.ts"
```

Add the import and provider entry in that module. Ensure `WorkflowRunRepository`, `WorkflowRepository`, and `WorkflowParserService` are importable in that module's context (they are already used by sibling runtime services / the doctor module — add to imports/providers if the module does not already transitively provide them).

- [ ] **Step 6: Verify the API still boots/builds**

Run: `npm run build:api`
Expected: build succeeds with no DI/type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime/job-output-contract-resolver.service.ts apps/api/src/workflow/workflow-runtime/job-output-contract-resolver.service.spec.ts apps/api/src/workflow/workflow-runtime/*.module.ts
git commit -m "feat(runtime): resolve a run's job output_contract for set_job_output validation"
```

---

## Task 3: `set_job_output` rejects type-invalid fields with feedback (Fix B, behavior)

When `set_job_output` is called with a field whose value violates the job's declared output-contract _type_, reject the call with a `BadRequestException` carrying field-level feedback, so the agent corrects the data in the same turn instead of receiving `{ok:true}`. Validate **only the types of the fields present in this call** (merged with prior writes) — do **not** enforce missing `required` fields here, so incremental/partial `set_job_output` writes used by other jobs are not broken.

**Files:**

- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.ts`
- Test: `apps/api/src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.spec.ts`

**Interfaces:**

- Consumes: `JobOutputContractResolverService.resolveContract(...)` (Task 2); `findOutputContractTypeMismatch(value, schema, field)` from `../workflow-output-contract-type.helpers`.
- Produces: no new public symbols; `setJobOutput` gains a type-validation gate that throws `BadRequestException` on a type mismatch and emits `workflow.runtime.set_job_output.rejected` with `errorCode: 'set_job_output_type_mismatch'`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.spec.ts` (extend the existing constructor/mocks; add a mock for the new resolver dependency):

```typescript
it("rejects a field whose value violates the contract type", async () => {
  // resolver returns the split contract: child_ac_assignments must be
  // array<object{child_ref,ac_ids:array<string>}>
  contractResolver.resolveContract.mockResolvedValue({
    required: ["child_ac_assignments"],
    types: {
      child_ac_assignments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            child_ref: "string",
            ac_ids: { type: "array", items: "string" },
          },
        },
      },
    },
  });

  await expect(
    service.setJobOutput("run-1", "split_work_item", {
      child_ac_assignments: [""],
    }),
  ).rejects.toThrow(/child_ac_assignments/);

  // and the malformed value is NOT persisted
  expect(stateManager.setVariable).not.toHaveBeenCalled();
});

it("accepts a well-formed value for the same contract", async () => {
  contractResolver.resolveContract.mockResolvedValue({
    required: ["child_ac_assignments"],
    types: {
      child_ac_assignments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            child_ref: "string",
            ac_ids: { type: "array", items: "string" },
          },
        },
      },
    },
  });

  await service.setJobOutput("run-1", "split_work_item", {
    child_ac_assignments: [{ child_ref: "p-child-1", ac_ids: ["AC-1"] }],
  });

  expect(stateManager.setVariable).toHaveBeenCalled();
});

it("does not enforce missing required fields (partial writes allowed)", async () => {
  contractResolver.resolveContract.mockResolvedValue({
    required: ["a", "b"],
    types: { a: "string", b: "array" },
  });

  // Only 'a' provided; 'b' missing — must NOT throw.
  await service.setJobOutput("run-1", "job-x", { a: "hello" });
  expect(stateManager.setVariable).toHaveBeenCalled();
});

it("persists normally when the job has no contract", async () => {
  contractResolver.resolveContract.mockResolvedValue(null);
  await service.setJobOutput("run-1", "job-x", { anything: [""] });
  expect(stateManager.setVariable).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.spec.ts`
Expected: FAIL — constructor arity mismatch (new resolver dep) and/or the malformed value is persisted instead of rejected.

- [ ] **Step 3: Implement the type-validation gate**

In `workflow-runtime-set-job-output.service.ts`:

1. Add the import:

```typescript
import { findOutputContractTypeMismatch } from "../workflow-output-contract-type.helpers";
import { JobOutputContractResolverService } from "./job-output-contract-resolver.service";
```

2. Inject the resolver in the constructor:

```typescript
  constructor(
    private readonly stateManager: StateManagerService,
    private readonly eventLedger: EventLedgerService,
    private readonly terminalRunGuard: WorkflowRuntimeTerminalRunGuardService,
    private readonly contractResolver: JobOutputContractResolverService,
  ) {}
```

3. After the existing reserved-keys check and _before_ computing `stateKey`/merging (i.e. after the `reservedKeys` block near line 124), insert the type gate. Validate the merged view's provided fields so a multi-call sequence is checked against what will actually be stored:

```typescript
const contractTypeError = await this.findContractTypeError(
  workflowRunId,
  jobId,
  normalizedData,
);
if (contractTypeError) {
  await this.eventLedger.emitBestEffort({
    domain: "workflow",
    eventName: "workflow.runtime.set_job_output.rejected",
    outcome: "denied",
    workflowRunId,
    jobId,
    toolName: "set_job_output",
    errorCode: "set_job_output_type_mismatch",
    errorMessage: contractTypeError,
  });
  throw new BadRequestException(contractTypeError);
}
```

4. Add the private helper (validates only the types of fields present in `data`, never `required`/completeness):

```typescript
  /**
   * Validate the declared TYPES of the fields present in this set_job_output
   * call against the job's output_contract. Returns a human-actionable message
   * on the first mismatch, or null when the contract is absent or all provided
   * fields are well-typed. Missing required fields are intentionally NOT
   * enforced here — that remains the post-turn output-contract check, so
   * incremental (partial) set_job_output writes keep working.
   */
  private async findContractTypeError(
    workflowRunId: string,
    jobId: string,
    data: Record<string, unknown>,
  ): Promise<string | null> {
    const contract = await this.contractResolver.resolveContract(
      workflowRunId,
      jobId,
    );
    if (!contract?.types) {
      return null;
    }
    for (const [field, schema] of Object.entries(contract.types)) {
      if (!(field in data) || data[field] === null || data[field] === undefined) {
        continue;
      }
      const mismatch = findOutputContractTypeMismatch(data[field], schema, field);
      if (mismatch) {
        return (
          `set_job_output field '${mismatch.field}' has the wrong type ` +
          `(expected ${mismatch.expected}, got ${mismatch.actual}). ` +
          `Provide '${field}' with the declared shape and call set_job_output again.`
        );
      }
    }
    return null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.spec.ts`
Expected: PASS (all cases, including the pre-existing tests).

- [ ] **Step 5: Run the controller test if present**

Find and run any test for `workflow-runtime-lifecycle.controller.ts` to confirm the `{ ok: true }` happy path is unaffected when no mismatch occurs:

```bash
grep -rl "setJobOutput" apps/api/src --include="*.controller.spec.ts"
```

Run the matching spec; Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.ts apps/api/src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.spec.ts
git commit -m "fix(runtime): set_job_output rejects type-invalid fields with actionable feedback

Previously set_job_output returned {ok:true} regardless of shape, so an
agent that submitted a placeholder child_ac_assignments=[\"\"] got a
false-positive and completed the step. Now the provided fields are
type-checked against the job's output_contract and rejected in-turn with
a field-level message. Missing required fields are still deferred to the
post-turn contract check so partial writes keep working."
```

---

## Task 4: Telemetry assertion for the new rejection (Fix B, observability)

Lock in the `set_job_output_type_mismatch` ledger signal so we can observe which provider/job produces malformed structured output (mirrors the existing `normalized_xml_artifact` telemetry intent).

**Files:**

- Test: `apps/api/src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("emits a rejected ledger signal on a type mismatch", async () => {
  contractResolver.resolveContract.mockResolvedValue({
    required: ["child_ac_assignments"],
    types: {
      child_ac_assignments: { type: "array", items: { type: "object" } },
    },
  });

  await expect(
    service.setJobOutput("run-1", "split_work_item", {
      child_ac_assignments: [""],
    }),
  ).rejects.toThrow();

  expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
    expect.objectContaining({
      eventName: "workflow.runtime.set_job_output.rejected",
      errorCode: "set_job_output_type_mismatch",
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.spec.ts`
Expected: PASS — the emit was implemented in Task 3 Step 3; this test characterizes it. If it fails, the `emitBestEffort` call shape in Task 3 is wrong; align it.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime/workflow-runtime-set-job-output.service.spec.ts
git commit -m "test(runtime): assert set_job_output_type_mismatch ledger telemetry"
```

---

## Task 5: Classify `-32000 Invalid arguments` as `split_coverage_invalid` (Fix C)

Extend the coverage-validation classifier so a schema rejection from `kanban.work_item_validate_split_coverage` ("Invalid arguments for kanban MCP tool …") is classified `split_coverage_invalid`, routing it into the existing, already-bounded `redispatch_producer_with_feedback` repair (re-runs the split agent with the validation message, up to `WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING`, then `retry_limit_exceeded` → graceful fail) instead of `ambiguous_failure`/`human_required`.

**Files:**

- Modify: `apps/api/src/workflow/workflow-repair/failure-classification-rules.ts:189-204`
- Test: `apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts`

**Interfaces:**

- Consumes: `classifyFailureEvidence(evidence)` from the same module (existing).
- Produces: an extended `classifyCoverageValidationFailure` matcher; no new exported symbols.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts` (follow the file's existing `classifyFailureEvidence` test pattern for building `NormalizedFailureEvidence`):

```typescript
it("classifies a -32000 Invalid arguments rejection from the split-coverage tool as split_coverage_invalid", () => {
  const decision = classifyFailureEvidence(
    buildEvidence({
      errorMessage:
        "job_failed_after_retries: MCP tool invocation failed: " +
        "MCP HTTP request failed (-32000): Invalid arguments for kanban MCP tool " +
        "kanban.work_item_validate_split_coverage",
    }),
  );
  expect(decision.class).toBe("split_coverage_invalid");
});

it("still classifies the coverage-logic rejection as split_coverage_invalid", () => {
  const decision = classifyFailureEvidence(
    buildEvidence({
      errorMessage:
        "Split coverage validation failed for 77112b26: uncovered parent " +
        "acceptance criteria: AC-2, AC-7",
    }),
  );
  expect(decision.class).toBe("split_coverage_invalid");
});
```

> `buildEvidence` is whatever helper/inline factory the existing spec uses to construct a `NormalizedFailureEvidence`. If the file has no such helper, construct the object inline with the minimal fields `buildSearchableText` reads: `errorCode`, `errorMessage`, `jobOutput`, `events: []`, `transcriptReferences: []`, `runtimeDiagnostics: {}`, `workflowRunId`, `jobId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-repair/failure-classification-rules.spec.ts`
Expected: FAIL — the first new test resolves to `ambiguous_failure` (the `-32000` message matches neither `SPLIT_COVERAGE_INVALID_PATTERN` nor `tool_contract_mismatch`). The second already passes.

- [ ] **Step 3: Extend the matcher**

In `failure-classification-rules.ts`, replace the `SPLIT_COVERAGE_INVALID_PATTERN` constant and `classifyCoverageValidationFailure` (lines 187-204) with a second pattern for the schema-rejection variant:

```typescript
// Downstream coverage validation rejected the producer job's output.
// Re-running the producer with the violation as feedback resolves it.
// Two failure surfaces: (1) the tool's own coverage-logic BadRequest, and
// (2) a schema rejection (-32000 Invalid arguments) when the producer emitted
// a malformed/empty child_ac_assignments that the tool's input schema refuses.
const SPLIT_COVERAGE_INVALID_PATTERN =
  /coverage validation failed[\s\S]*?(?:duplicated across children|uncovered parent acceptance criteria|unknown acceptance criteria not on the parent)/i;

const SPLIT_COVERAGE_SCHEMA_REJECTION_PATTERN =
  /invalid arguments for kanban mcp tool kanban\.work_item_validate_split_coverage/i;

function classifyCoverageValidationFailure(
  searchableText: string,
): RuleDecision | null {
  const matched =
    SPLIT_COVERAGE_INVALID_PATTERN.test(searchableText) ||
    SPLIT_COVERAGE_SCHEMA_REJECTION_PATTERN.test(searchableText);
  if (!matched) {
    return null;
  }
  return {
    class: "split_coverage_invalid",
    confidence: 0.85,
    reason:
      "A producer job emitted output that the downstream split-coverage validation rejected (coverage violation or malformed arguments); re-running the producer with the validation feedback can resolve it.",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-repair/failure-classification-rules.spec.ts`
Expected: PASS (both new tests + all existing).

- [ ] **Step 5: Run the classification integration suite**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-repair/workflow-failure-classification.integration.spec.ts`
Expected: PASS — confirms the classifier still maps `split_coverage_invalid` to the `redispatch_producer_with_feedback` policy end-to-end.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-repair/failure-classification-rules.ts apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts
git commit -m "fix(repair): classify split-coverage -32000 Invalid arguments as split_coverage_invalid

The schema-rejection variant of a split-coverage validation failure
(malformed/empty child_ac_assignments) previously fell through to
ambiguous_failure/human_required. Route it into the existing bounded
redispatch_producer_with_feedback repair instead."
```

---

## Task 6: Harden the split agent prompt (Fix D)

Make the failure mode hard for the model to fall into: explicitly forbid placeholder/empty `child_ac_assignments`, state that `set_job_output` returning `{ok:true}` does NOT mean the data was validated, and give a `workspace_root` hint for `publish_specs` (session `5c2aa465` wasted ~50s cycling `/workspace` → `.` → `/app` before landing on the clone path).

**Files:**

- Modify: `seed/workflows/prompts/work-item-split-default/split.md:88-141`

**Interfaces:** prompt text only; no code symbols.

- [ ] **Step 1: Add a `workspace_root` hint to Step 6 (publish)**

In `split.md`, after the Step 6 `kanban.publish_specs` instruction (around line 107-110), append:

```markdown
When calling `kanban.publish_specs`, set `workspace_root` to the absolute
clone path for this run (the directory that actually contains `docs/work-items`
on the kanban service host), e.g. `/data/nexus-workspaces/clones/{{trigger.scopeId}}`.
Runner-local paths like `/workspace` and bare `.` are NOT visible to the kanban
service and will fail with a path error.
```

- [ ] **Step 2: Harden the Step 7 output instructions**

In `split.md` Step 7, immediately before the `set_job_output` JSON example (before line 123), insert:

```markdown
> CRITICAL: `child_ac_assignments` MUST be a non-empty array with exactly one
> object per child — `{ "child_ref": "...", "ac_ids": ["AC-1", ...] }`. NEVER
> submit a placeholder, an empty array, or `[""]`. Submit the SAME assignments
> you validated in Step 5.
>
> `set_job_output` returning `{ "ok": true }` only means the call was accepted —
> it does NOT confirm your data is correct or complete. You are responsible for
> the contents. If you submit a malformed `child_ac_assignments`, the call is
> rejected with a type error; read it, fix the array, and call again. Do not
> call `step_complete` until `set_job_output` has accepted a complete,
> well-formed object.
```

- [ ] **Step 3: Verify the seed still parses**

Run: `npm run test --workspace=apps/api -- run src/workflow/testing/seed-workflows.dry-run.spec.ts`
Expected: PASS — prompt files are referenced by `prompt_file`; the dry-run resolves them.

- [ ] **Step 4: Commit**

```bash
git add seed/workflows/prompts/work-item-split-default/split.md
git commit -m "docs(split-prompt): forbid placeholder child_ac_assignments and clarify set_job_output is not validation; add workspace_root hint"
```

---

## Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the API unit suite**

Run: `npm run test:api`
Expected: PASS (no regressions). If unrelated pre-existing failures appear, confirm they reproduce on a clean checkout before attributing them here.

- [ ] **Step 2: Lint the API workspace**

Run: `npm run lint:api`
Expected: clean — no new findings, no suppressions added.

- [ ] **Step 3: Build the API**

Run: `npm run build:api`
Expected: success.

- [ ] **Step 4: Final commit (if any lint/format fixups)**

```bash
git add -A
git commit -m "chore(split-defense): lint/build fixups for split-coverage empty-assignment defense"
```

---

## Self-Review

**Spec coverage:**

- Fix A (deep contract typing) → Task 1. ✓
- Fix B (set_job_output validation feedback) → Tasks 2 (resolver), 3 (gate), 4 (telemetry). ✓
- Fix C (route -32000 to bounded auto-repair, "feedback + X retries + then fail") → Task 5; the redispatch + per-action attempt bound already exist (`repair-policy.config.ts:75-83`, `workflow-repair-dispatch.service.ts:73-92`) and are exercised by Task 5 Step 5. ✓
- Fix D (prompt hardening + workspace_root hint) → Task 6. ✓
- Verification → Task 7. ✓

**Type consistency:** `resolveContract(workflowRunId, jobId): Promise<OutputContract | null>` is defined in Task 2 and consumed identically in Task 3. `findOutputContractTypeMismatch(value, schema, field)` and `OutputContractTypeSchema` are used as defined in `@nexus/core` / the helpers module. The deep schema literal in Task 1's test mirrors the YAML in Task 1 Step 3.

**Placeholder scan:** none — every code/test/YAML/prompt step contains literal content; module-registration (Task 2 Step 5) names the exact provider and gives the grep to locate the module.

**Open verification points (call out during execution, do not assume):**

1. Task 2 Step 5: confirm the exact module file that provides `WorkflowRuntimeSetJobOutputService` and that `WorkflowRunRepository` / `WorkflowRepository` / `WorkflowParserService` are resolvable there (add to imports if not).
2. Task 3 Step 1: extend the _existing_ spec's constructor mock setup — add the `contractResolver` mock to the existing `new WorkflowRuntimeSetJobOutputService(...)` call so arity matches.
3. Task 5 Step 1: reuse the spec's existing evidence factory; only fall back to the inline object if none exists.

## Recovery of the two failed runs

Runs `e09fa224` and `5c2aa465` are unrecoverable in place (their stored `split_work_item` output is corrupted to `child_ac_assignments:[""]`). After deploy+reseed, re-trigger the split for the parent work item `77112b26-7f4d-4457-9a99-8ad6414c8509` (project `458935f0-213e-4bbe-89d1-8883e0efa9ad`).

## Deploy checklist (out of scope for the tasks above)

- [ ] Reseed so the running stack picks up the modified `seed/workflows/**` (Tasks 1, 6).
- [ ] Rebuild + redeploy `nexus-api` (Tasks 2–5).
- [ ] Re-trigger split for parent `77112b26-…` and confirm a clean `split_completed` with a well-formed `child_ac_assignments`.
- [ ] If a future split still emits malformed output, confirm the ledger now shows `set_job_output_type_mismatch` (Fix B) and/or a `split_coverage_invalid` classification with `redispatch_producer_with_feedback` (Fix C) rather than `ambiguous_failure`.
