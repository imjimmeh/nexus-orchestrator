# Fix tryClaimInternalJobFlag jsonb Intermediate Key Bug

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `tryClaimInternalJobFlag` so it correctly creates intermediate JSONB objects, making `tryMarkJobQueued` an effective dedup guard and preventing DAG steps from being double-queued.

**Architecture:** PostgreSQL's `jsonb_set` with `create_missing=true` only creates a leaf key when its direct parent already exists — it does **not** recursively create intermediate objects. `tryClaimInternalJobFlag` uses a single `jsonb_set` call for a 3-level path (`_internal.queued_jobs.<jobId>`), which silently no-ops when `_internal.queued_jobs` doesn't yet exist (returns 1 affected row but leaves JSONB unchanged). The fix mirrors the pattern already used in `setStateVariableAtomic`: build nested `jsonb_set` calls that create each intermediate level before setting the leaf, extracting the shared builder into a private utility method.

**Tech Stack:** TypeScript, NestJS, TypeORM QueryBuilder, PostgreSQL JSONB

---

## Background: Why This Matters

When a workflow step completes, `progressDagOrComplete` evaluates ALL remaining DAG levels and calls `enqueueEligibleDagNextJobs` for each. Multiple completing jobs (e.g. `provision_worktree` then `persist_provisioned_branch`) can each independently evaluate and attempt to queue the same downstream job (e.g. `implement_and_commit`). `tryMarkJobQueued` is the only dedup guard. Because the guard silently fails to set the flag, the job is queued once per completing predecessor — spawning concurrent duplicate execution agents on the same worktree.

---

## File Map

| File                                                                          | Action           | Responsibility                                                                                    |
| ----------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| `apps/api/src/workflow/database/repositories/workflow-run.repository.ts`      | Modify           | Fix `tryClaimInternalJobFlag` to use nested `jsonb_set`; extract `buildNestedJsonbSetExpr` helper |
| `apps/api/src/workflow/database/repositories/workflow-run.repository.spec.ts` | Create or modify | Unit/integration tests for `tryMarkJobQueued` idempotency                                         |

---

## Task 1: Reproduce the bug with a failing test

**Files:**

- Test: `apps/api/src/workflow/database/repositories/workflow-run.repository.spec.ts`

- [ ] **Step 1: Find or create the repository spec file**

Run:

```powershell
ls apps/api/src/workflow/database/repositories/
```

If `workflow-run.repository.spec.ts` already exists, read it first before adding tests. If not, create it.

- [ ] **Step 2: Write the failing test**

Add a test to `workflow-run.repository.spec.ts` that verifies `tryMarkJobQueued` correctly prevents a second queuing of the same job, even when `_internal.queued_jobs` does not pre-exist in `state_variables`.

The test needs a real Postgres connection. Use the pattern from `apps/api/src/workflow/testing/` or other integration specs (they connect to the test DB via Docker). Check `apps/api/vitest.config.ts` and `apps/api/src/workflow/workflow-engine.service.spec.ts` for the test setup pattern.

```typescript
describe("tryMarkJobQueued", () => {
  it("returns true on first call and false on second call even when _internal.queued_jobs does not pre-exist", async () => {
    // Create a RUNNING workflow run with state_variables that has NO queued_jobs key
    const runId = await createRunWithState({
      _internal: {
        completed_jobs: { provision_worktree: true },
        job_results: { provision_worktree: "success" },
      },
    });

    const first = await repository.tryMarkJobQueued(
      runId,
      "implement_and_commit",
    );
    const second = await repository.tryMarkJobQueued(
      runId,
      "implement_and_commit",
    );

    expect(first).toBe(true);
    expect(second).toBe(false);

    // Verify the flag is actually persisted
    const run = await repository.findById(runId);
    expect(
      run?.state_variables?.["_internal"]?.["queued_jobs"]?.[
        "implement_and_commit"
      ],
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run:

```powershell
npm run test --workspace=apps/api -- --run --reporter=verbose --testPathPattern="workflow-run.repository.spec"
```

Expected: FAIL — `expect(second).toBe(false)` fails because current implementation returns `true` both times (the flag is never set).

- [ ] **Step 4: Commit the failing test**

```bash
git add apps/api/src/workflow/database/repositories/workflow-run.repository.spec.ts
git commit -m "test(workflow): failing test for tryMarkJobQueued dedup when queued_jobs absent"
```

---

## Task 2: Fix `tryClaimInternalJobFlag` to use nested `jsonb_set`

**Files:**

- Modify: `apps/api/src/workflow/database/repositories/workflow-run.repository.ts:462-482`

- [ ] **Step 1: Read the current implementation**

Read `apps/api/src/workflow/database/repositories/workflow-run.repository.ts` lines 430–520 to confirm the exact current code before editing.

- [ ] **Step 2: Extract a shared builder and fix the claim method**

Replace the `tryClaimInternalJobFlag` private method (currently lines ~462–482) with the following implementation. The key change is building a nested `jsonb_set` expression that creates intermediate JSONB objects at each level of the path — identical to what `setStateVariableAtomic` already does.

```typescript
/**
 * Builds a nested `jsonb_set` SQL expression that creates missing intermediate
 * objects at each level of `segments`, then sets the leaf to `'true'::jsonb`.
 *
 * PostgreSQL's `jsonb_set` with `create_missing=true` only creates a leaf key
 * when its direct parent already exists; it does NOT recursively create
 * intermediate objects. This builder mirrors the approach in
 * `setStateVariableAtomic` to ensure intermediate levels are created.
 *
 * Also populates `params` with named parameters `:parentPath0`, `:parentPath1`,
 * … and `:leafPath` so they can be bound via `.setParameters(params)`.
 */
private buildNestedClaimExpr(
  segments: string[],
  params: Record<string, string>,
): string {
  const leafPath = `{${segments.join(',')}}`;
  params['leafPath'] = leafPath;

  let expr = `"state_variables"`;
  for (let i = 0; i < segments.length - 1; i++) {
    const paramName = `parentPath${i}`;
    params[paramName] = `{${segments.slice(0, i + 1).join(',')}}`;
    expr = `jsonb_set(${expr}, :${paramName}, COALESCE(${expr} #> :${paramName}, '{}'), true)`;
  }
  return `jsonb_set(${expr}, :leafPath, 'true'::jsonb, true)`;
}

/**
 * Atomically flip a per-job `_internal.<flagGroup>.<jobId>` flag from
 * not-`true` to `true` using nested Postgres `jsonb_set` calls, returning
 * `true` only for the caller that won the compare-and-set. This avoids the
 * read-modify-write race of the generic update path and is the single-writer
 * primitive behind the queue and completion idempotency guards.
 *
 * Uses nested `jsonb_set` (not a single call) to ensure intermediate objects
 * such as `_internal.queued_jobs` are created when they do not yet exist.
 * A single-level `jsonb_set` with `create_missing=true` only creates the
 * leaf key when its direct parent already exists; it silently no-ops (while
 * still returning 1 affected row) when any intermediate key is absent.
 */
private async tryClaimInternalJobFlag(
  id: string,
  flagGroup: 'queued_jobs' | 'completed_jobs',
  jobId: string,
): Promise<boolean> {
  const segments = ['_internal', flagGroup, jobId];
  const params: Record<string, string> = {};
  const expr = this.buildNestedClaimExpr(segments, params);

  const result = await this.repository
    .createQueryBuilder()
    .update(WorkflowRun)
    .set({
      state_variables: () => expr,
    })
    .where('id = :id', { id })
    .andWhere('status = :status', { status: WorkflowStatus.RUNNING })
    .andWhere(`COALESCE("state_variables" #>> :leafPath, 'false') != 'true'`)
    .setParameters({ ...params, id, status: WorkflowStatus.RUNNING })
    .execute();

  return (result.affected ?? 0) > 0;
}
```

Remove the old `tryClaimInternalJobFlag` method entirely and replace it with both methods above.

- [ ] **Step 3: Run the failing test to verify it now passes**

Run:

```powershell
npm run test --workspace=apps/api -- --run --reporter=verbose --testPathPattern="workflow-run.repository.spec"
```

Expected: PASS — both `first=true` and `second=false`, and the flag is persisted.

- [ ] **Step 4: Run the full API test suite to check for regressions**

Run:

```powershell
npm run test:api
```

Expected: all tests green.

- [ ] **Step 5: Typecheck**

Run:

```powershell
npm run build:api 2>&1 | Select-String -Pattern "error TS"
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit the fix**

```bash
git add apps/api/src/workflow/database/repositories/workflow-run.repository.ts
git commit -m "fix(workflow): nested jsonb_set in tryClaimInternalJobFlag to create intermediate objects

PostgreSQL jsonb_set with create_missing=true only creates a leaf key when its
direct parent already exists. tryClaimInternalJobFlag used a single jsonb_set
call for a 3-level path (_internal.queued_jobs.<jobId>), silently no-oping
when _internal.queued_jobs did not exist, while still returning 1 affected row.
This caused tryMarkJobQueued to always return true, breaking the dedup guard
and allowing the same DAG job to be queued once per completing predecessor —
spawning concurrent duplicate agents on the same worktree.

Fix mirrors the pattern in setStateVariableAtomic: build nested jsonb_set
calls that create each intermediate object before setting the leaf."
```

---

## Task 3: Verify the fix covers the `completed_jobs` flag path too

The same `tryClaimInternalJobFlag` is used for `tryMarkJobCompleted`. The existing tests and the current production behaviour show this path works, because `markJobCompleted`/`markJobSkipped` (via `setStateVariableAtomic`) always pre-create `_internal.completed_jobs` before `tryMarkJobCompleted` is called. The fix makes `tryClaimInternalJobFlag` robust regardless of whether the parent exists.

- [ ] **Step 1: Add a regression test for `tryMarkJobCompleted`**

In the same spec file, add:

```typescript
describe("tryMarkJobCompleted", () => {
  it("returns true on first call and false on second call when completed_jobs does not pre-exist", async () => {
    // No _internal.completed_jobs pre-created
    const runId = await createRunWithState({ _internal: {} });

    const first = await repository.tryMarkJobCompleted(runId, "some_job");
    const second = await repository.tryMarkJobCompleted(runId, "some_job");

    expect(first).toBe(true);
    expect(second).toBe(false);

    const run = await repository.findById(runId);
    expect(
      run?.state_variables?.["_internal"]?.["completed_jobs"]?.["some_job"],
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it passes (was already broken, now fixed)**

Run:

```powershell
npm run test --workspace=apps/api -- --run --reporter=verbose --testPathPattern="workflow-run.repository.spec"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/workflow/database/repositories/workflow-run.repository.spec.ts
git commit -m "test(workflow): regression test for tryMarkJobCompleted when completed_jobs absent"
```

---

## Task 4: Manual recovery for the current double-queued run

The live run `3c0afb73-c7a0-400f-9d58-5cfa1232abc8` has two `senior_dev` subagents running concurrently against the same worktree. This is a one-time manual remediation; it is not part of the automated fix.

- [ ] **Step 1: Identify the older of the two running sessions**

Run:

```sql
SELECT id, created_at, status
FROM chat_sessions
WHERE workflow_run_id = '3c0afb73-c7a0-400f-9d58-5cfa1232abc8'
  AND agent_profile_name = 'senior_dev'
  AND status = 'RUNNING'
ORDER BY created_at;
```

The EARLIER session (created at `2026-06-16 17:31:27`) is the legitimate one. The LATER session (`2026-06-16 17:36:17`) is the duplicate.

- [ ] **Step 2: Decide on intervention**

Options:

- **Wait and observe**: Both agents are writing to the same worktree. If one finishes first and commits, the other will likely encounter a git conflict or write redundant code. Manual cleanup of the worktree branch may be needed.
- **Kill the duplicate**: If the PI runner supports terminating a session by chat_session_id, terminate the later one now to prevent conflicting commits.

Consult the user before taking destructive action.

---

## Self-Review

### Spec coverage

- [x] Root cause: `jsonb_set` single call fails to create intermediate objects — covered in Task 2
- [x] Guard never fires → double-queue → concurrent agents — fixed via nested `jsonb_set`
- [x] Test proves bug then proves fix — Task 1 (red) + Task 2 (green)
- [x] Regression for `tryMarkJobCompleted` path — Task 3
- [x] Live run recovery — Task 4 (manual)

### Placeholder scan

- No TBDs or TODOs in code steps
- All test helpers (`createRunWithState`) need to be adapted to the actual test setup pattern found in the spec file — implementer must read existing test setup before writing

### Type consistency

- `buildNestedClaimExpr` returns `string` and mutates the passed `params: Record<string, string>` — consistent with callers
- `WorkflowStatus.RUNNING` import already present in `workflow-run.repository.ts`
