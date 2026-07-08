# Durable Agent-Await Suspend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent runtime durably suspend an agent's turn when a runtime tool returns `executionStatus: "suspended"`, so the CEO orchestrator executes delegated child workflows one-at-a-time and resumes with their results — instead of ignoring the directive, racing ahead, spawning a contextless default workflow, and masking the resulting 400s.

**Architecture:** The whole agent turn runs inside the Claude Agent SDK `query()` subprocess; our runtime tools execute via the SDK MCP server (`toSdkTool` → `spec.invoke` → `executeApiCallback`), and the SDK continues the turn after each tool result. There is **no runner-side handling** of the API's `suspended` directive today. We add an end-to-end suspend signal: api-callback flags the directive (`terminate: true`), the SDK tool handler aborts the in-flight query and marks the session suspended, the session emits a distinct `agent_end{ stopReason: "suspended" }`, the runtime server reports `suspended: true`, and the API completion path treats a parked/suspended turn as "leave RUNNING for durable resume" (the resume half — child-terminal listener → await registry CAS → `dependency-parent-resume` re-enqueue — is already built). Separately we fix `await_agent_workflow` so it never silently launches `orchestration_invoke_agent_default`, surface tool failures as real `is_error`, and correct the CEO prompt so it does not double-await after `delegate_*`.

**Tech Stack:** TypeScript, Vitest (`cross-env vitest run`), NestJS (API), Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), monorepo workspaces. `packages/core` must be built first; harness packages resolve `@nexus/harness-runtime` via **dist**, so rebuild dist after editing shared exports (see memory `worktree-core-dist-resolution`).

**Beads issues:** `kanban-atuq` (P1, suspend not honored — Phase 2), `kanban-deuu` (P2, await attach semantics — Phase 3), `kanban-an5f` (P2, masked failures — Phase 1), `kanban-4jhn` (P2, CEO double-await — Phase 4; depends on atuq+deuu).

## Decisions (confirmed 2026-06-14)

These were flagged at plan review and are now **locked** — implement as written, do not re-litigate:

1. **Phase 3 / kanban-deuu — attach-to-run + fail-closed.** `await_agent_workflow` gains explicit attach-to-run semantics (`awaited_run_ids` / `awaited_run_id`) AND the silent `orchestration_invoke_agent_default` default is removed (a call resolving to no launch target and no attach ids throws `BadRequestException`). The "drop attach, rely on `delegate_*`" alternative is rejected.
2. **Suspend reporting shape.** A deliberately-suspended turn ends as a clean `agent_end{ ok: true, stopReason: "suspended", suspended: true }` — never an error — so the API routes it to the parked-aware `handleJobComplete` instead of the failure/retry path.
3. **API parked-guard signal.** The output-contract enforcement short-circuits on `run.wait_reason` / `run.awaiting_input` (set synchronously by `register()` during the suspending tool call) rather than threading the harness `suspended` flag through the HTTP result — it is the reliable signal at contract-check time.
4. **Scope: claude-code engine only.** `packages/pi-runner/src` is retired; only the claude-code engine receives the suspend wiring. Mirror to a PI engine only if a live resume-capable one is later found.

The three "open confirmations" listed in Self-review remain **read-first verification steps** during execution (SDK cancel-option name, `CanonicalSessionEvent` stopReason union, `checkOutputContractAndRetry` return shape) — they are facts to confirm in code, not design choices.

**Evidence (run `5ad31570`, CEO strategize):** one uninterrupted turn fired `delegate_rediscovery` → `await_agent_workflow` (spawned phantom default run `2f56e0d7`) → `await_agent_workflow` (400 "concurrency policy skipped") → `delegate_charter_refinement` → `await` (400) → `delegate_roadmap_planning` → `delegate_goal_backlog_planning` → `kanban_record_strategic_intent`, consuming **zero** child results. All recorded `outcome=success`/`isError:false`.

---

## Pre-flight (run once before Phase 1)

- [ ] **Step 0.1: Install deps + build core in the worktree**

This worktree is a fresh branch; workspaces need install and `@nexus/core` dist.

Run:

```bash
npm install
npm run build --workspace=packages/core
npm run build --workspace=packages/harness-runtime
```

Expected: all succeed (core + harness-runtime emit `dist/`).

- [ ] **Step 0.2: Baseline the packages we will touch**

Run:

```bash
npm run test --workspace=packages/harness-runtime
npm run test --workspace=apps/api -- workflow-runtime-await-actions
```

Expected: PASS (or note pre-existing failures before changing anything). If unrelated suites fail on the clean base, record them — do not treat as regressions.

---

## Phase 1 — Surface tool failures as real `is_error` (kanban-an5f)

**Why first:** independent, smallest, and it makes the suspend behaviour in Phase 2 observable (a suspended/failed tool result will no longer be silently `isError:false`).

**Root cause:** `toSdkTool` (`packages/harness-engine-claude-code/src/to-sdk-tool.ts:14`) returns `spec.invoke(input)` verbatim. The Claude SDK reads `is_error` from the returned tool result; our `ToolCallResult` only carries `details.ok`, never `isError`, so the SDK defaults `is_error:false`. The api-callback 400 path (`buildApiCallbackFailureResult`) already sets `details.ok:false` — it just never reaches the SDK.

**Files:**

- Modify: `packages/harness-engine-claude-code/src/to-sdk-tool.ts`
- Modify: `packages/harness-engine-claude-code/src/to-sdk-tool.types.ts` (if `SdkTool.handler` return type needs `isError`)
- Test: `packages/harness-engine-claude-code/src/to-sdk-tool.spec.ts` (create)

- [ ] **Step 1.1: Write the failing test**

Create `packages/harness-engine-claude-code/src/to-sdk-tool.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { toSdkTool } from "./to-sdk-tool.js";
import type { CanonicalToolSpec } from "@nexus/harness-runtime";

function specReturning(result: unknown): CanonicalToolSpec {
  return {
    name: "demo.tool",
    description: "demo",
    parameters: { type: "object", properties: {} },
    invoke: async () => result,
  };
}

describe("toSdkTool", () => {
  it("marks the SDK result is_error when details.ok is false", async () => {
    const tool = toSdkTool(
      specReturning({
        content: [{ type: "text", text: "boom" }],
        details: { ok: false },
      }),
    );
    const out = (await tool.handler({})) as {
      content: unknown[];
      isError?: boolean;
    };
    expect(out.isError).toBe(true);
    expect(out.content).toEqual([{ type: "text", text: "boom" }]);
  });

  it("leaves is_error falsy for a successful result", async () => {
    const tool = toSdkTool(
      specReturning({
        content: [{ type: "text", text: "ok" }],
        details: { ok: true },
      }),
    );
    const out = (await tool.handler({})) as { isError?: boolean };
    expect(out.isError ?? false).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- to-sdk-tool`
Expected: FAIL — `isError` is `undefined` (handler returns spec result verbatim).

- [ ] **Step 1.3: Implement minimal change**

Replace the handler in `packages/harness-engine-claude-code/src/to-sdk-tool.ts`:

```typescript
export function toSdkTool(spec: CanonicalToolSpec): SdkTool {
  return {
    name: spec.name,
    description: spec.description,
    // The SDK's `tool()` requires a Zod schema; mounted tools carry JSON
    // Schema (what PI consumes), so convert at the boundary.
    parameters: jsonSchemaToZod(spec.parameters),
    handler: async (input: Record<string, unknown>) => {
      const result = (await spec.invoke(input)) as {
        content: unknown[];
        details?: { ok?: boolean };
      };
      // The SDK reads `is_error` from the tool result; our ToolCallResult only
      // carries `details.ok`. Without this, API-callback 4xx/{success:false}
      // responses surface as successful tool results (isError:false), so the
      // model and the event ledger never see the failure. See kanban-an5f.
      const isError = result?.details?.ok === false;
      return isError ? { ...result, isError: true } : result;
    },
  };
}
```

If `SdkTool` / its `handler` return type is strict, add `isError?: boolean` to the relevant type in `to-sdk-tool.types.ts`.

- [ ] **Step 1.4: Run the test to verify it passes**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- to-sdk-tool`
Expected: PASS (both cases).

- [ ] **Step 1.5: Typecheck the package**

Run: `npm run build --workspace=packages/harness-engine-claude-code`
Expected: builds clean.

- [ ] **Step 1.6: Commit**

```bash
git add packages/harness-engine-claude-code/src/to-sdk-tool.ts packages/harness-engine-claude-code/src/to-sdk-tool.types.ts packages/harness-engine-claude-code/src/to-sdk-tool.spec.ts
git commit -m "fix(harness-claude-code): surface tool details.ok=false as SDK is_error (kanban-an5f)"
```

---

## Phase 2 — Runner honors `executionStatus: "suspended"` (kanban-atuq)

**Approach:** Detect the suspend directive at the api-callback boundary and flag the existing `ToolCallResult.terminate` field. The SDK tool handler, on `terminate`, aborts the in-flight `query()` via an `AbortController` and marks the session suspended. The session emits `agent_end` with `stopReason: "suspended"` (NOT an error). The server reports `suspended: true`. The API completion path leaves the parked run RUNNING and skips output-contract enforcement (the run is already parked by `register()` setting `wait_reason='dependency'`; resume is already wired).

### Task 2A: api-callback flags the suspend directive

**Files:**

- Modify: `packages/harness-runtime/src/tools/api-callback.ts` (`buildApiCallbackSuccessResult`, ~line 381)
- Test: `packages/harness-runtime/src/tools/api-callback.spec.ts`

- [ ] **Step 2A.1: Write the failing test**

Add to `packages/harness-runtime/src/tools/api-callback.spec.ts` (import the exported `buildApiCallbackSuccessResult`; if it is not exported, export it):

```typescript
describe("buildApiCallbackSuccessResult — suspend directive", () => {
  it("sets terminate when nested data.executionStatus is 'suspended'", () => {
    const result = buildApiCallbackSuccessResult({
      toolName: "await_agent_workflow",
      status: 200,
      responseText: "{}",
      responseData: {
        success: true,
        data: {
          ok: true,
          requestedAction: "await_agent_workflow",
          executionStatus: "suspended",
          awaitId: "a1",
          awaitedRunIds: ["r1"],
        },
      },
      attempt: 1,
    });
    expect(result.terminate).toBe(true);
    expect((result.details as { ok?: boolean }).ok).toBe(true);
  });

  it("does not set terminate for an ordinary success", () => {
    const result = buildApiCallbackSuccessResult({
      toolName: "query_memory",
      status: 200,
      responseText: "{}",
      responseData: { success: true, data: { ok: true } },
      attempt: 1,
    });
    expect(result.terminate ?? false).toBe(false);
  });
});
```

- [ ] **Step 2A.2: Run the test to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- api-callback`
Expected: FAIL — `terminate` is `undefined` (and possibly `buildApiCallbackSuccessResult` not exported).

- [ ] **Step 2A.3: Implement the suspend detection**

In `packages/harness-runtime/src/tools/api-callback.ts`, ensure `buildApiCallbackSuccessResult` is exported, and update it to detect the directive. The directive lives at `responseData.data.executionStatus` (camelCase, nested under `data`):

```typescript
export function buildApiCallbackSuccessResult(params: {
  toolName: string;
  status: number;
  responseText: string;
  responseData: Record<string, unknown>;
  attempt: number;
}): ToolCallResult<Record<string, unknown>> {
  const resultText = formatApiCallbackResultText(
    params.toolName,
    params.responseData,
    params.responseText,
  );

  const dataOk =
    typeof params.responseData.ok === "boolean" ? params.responseData.ok : true;
  const nestedData =
    typeof params.responseData.data === "object" &&
    params.responseData.data !== null
      ? (params.responseData.data as Record<string, unknown>)
      : undefined;
  const executionFailed =
    nestedData?.execution_status === "failed" || nestedData?.ok === false;

  // A `suspended` directive (durable agent-await) instructs the runner to end
  // the turn NOW and park until the awaited children finish. Without honoring
  // it the agent keeps issuing tool calls in the same turn, spawning extra
  // children and masking failures. See kanban-atuq. Field is camelCase and
  // nested under `data`.
  const suspended = nestedData?.executionStatus === "suspended";

  return {
    content: [{ type: "text", text: resultText }],
    ...(suspended ? { terminate: true } : {}),
    details: {
      ok: dataOk && !executionFailed,
      action: `${params.toolName}_completed`,
      status: params.status,
      attempt: params.attempt,
      ...params.responseData,
    },
  };
}
```

- [ ] **Step 2A.4: Run the test to verify it passes**

Run: `npm run test --workspace=packages/harness-runtime -- api-callback`
Expected: PASS.

- [ ] **Step 2A.5: Rebuild harness-runtime dist (consumed by the engine package)**

Run: `npm run build --workspace=packages/harness-runtime`
Expected: builds clean.

- [ ] **Step 2A.6: Commit**

```bash
git add packages/harness-runtime/src/tools/api-callback.ts packages/harness-runtime/src/tools/api-callback.spec.ts
git commit -m "feat(harness-runtime): flag terminate on suspended api-callback directive (kanban-atuq)"
```

### Task 2B: SDK tool handler aborts the turn on `terminate`

**Goal:** When a tool result carries `terminate: true`, abort the SDK query so the model gets no further turn, and record that this was a deliberate suspend.

**Files:**

- Modify: `packages/harness-engine-claude-code/src/to-sdk-tool.ts` (handler must signal suspend)
- Modify: `packages/harness-engine-claude-code/src/claude-code-engine.ts` (create `AbortController`, thread a suspend callback, pass `abortController` to `query`)
- Modify: `packages/harness-engine-claude-code/src/claude-code-session.ts` (track `suspended`, emit suspended `agent_end`)
- Test: `packages/harness-engine-claude-code/src/to-sdk-tool.spec.ts`, `packages/harness-engine-claude-code/src/claude-code-session.spec.ts` (create)

- [ ] **Step 2B.1: Write the failing test for the handler suspend callback**

Add to `to-sdk-tool.spec.ts`. The handler must invoke an injected `onTerminate` callback when the result has `terminate:true`:

```typescript
it("calls onTerminate when the tool result requests termination", async () => {
  let terminated = false;
  const tool = toSdkTool(
    {
      name: "await_agent_workflow",
      description: "d",
      parameters: { type: "object", properties: {} },
      invoke: async () => ({
        content: [{ type: "text", text: "suspended" }],
        details: { ok: true },
        terminate: true,
      }),
    },
    {
      onTerminate: () => {
        terminated = true;
      },
    },
  );
  await tool.handler({});
  expect(terminated).toBe(true);
});
```

- [ ] **Step 2B.2: Run to verify it fails**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- to-sdk-tool`
Expected: FAIL — `toSdkTool` takes one argument; no `onTerminate`.

- [ ] **Step 2B.3: Add the `onTerminate` option to `toSdkTool`**

Update `to-sdk-tool.ts` (combine with Phase 1's `isError` logic):

```typescript
export interface ToSdkToolOptions {
  /** Invoked when a tool result requests turn termination (durable suspend). */
  onTerminate?: () => void;
}

export function toSdkTool(
  spec: CanonicalToolSpec,
  options: ToSdkToolOptions = {},
): SdkTool {
  return {
    name: spec.name,
    description: spec.description,
    parameters: jsonSchemaToZod(spec.parameters),
    handler: async (input: Record<string, unknown>) => {
      const result = (await spec.invoke(input)) as {
        content: unknown[];
        details?: { ok?: boolean };
        terminate?: boolean;
      };
      if (result?.terminate === true) {
        options.onTerminate?.();
      }
      const isError = result?.details?.ok === false;
      return isError ? { ...result, isError: true } : result;
    },
  };
}
```

- [ ] **Step 2B.4: Run to verify the handler test passes**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- to-sdk-tool`
Expected: PASS (all three cases).

- [ ] **Step 2B.5: Write the failing session-suspend test**

Create `packages/harness-engine-claude-code/src/claude-code-session.spec.ts`. The session must, when `suspend()` has been called, end its consume loop by emitting `agent_end` with `stopReason: "suspended"` and `ok: true` rather than an error:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ClaudeCodeSession } from "./claude-code-session.js";
import { ClaudeEventMapper } from "./map-claude-event.js";
import type { CanonicalSessionEvent } from "@nexus/core";

function deferredGenerator(): {
  gen: AsyncIterable<unknown>;
  abort: () => void;
} {
  let rejectFn!: (e: unknown) => void;
  const gen = (async function* () {
    yield { type: "system", session_id: "sess-1" };
    await new Promise<void>((_, reject) => {
      rejectFn = reject;
    });
  })();
  return { gen, abort: () => rejectFn(new Error("AbortError")) };
}

describe("ClaudeCodeSession suspend", () => {
  it("emits a suspended agent_end (ok:true) when suspended before the stream errors", async () => {
    const { gen, abort } = deferredGenerator();
    const events: CanonicalSessionEvent[] = [];
    const session = new ClaudeCodeSession(
      gen,
      new ClaudeEventMapper("strategize"),
      "strategize",
    );
    session.subscribe((e) => events.push(e));
    session.suspend();
    abort();
    await new Promise((r) => setTimeout(r, 0));
    const end = events.find((e) => e.type === "agent_end") as
      | (CanonicalSessionEvent & {
          output?: { ok?: boolean; stopReason?: string; suspended?: boolean };
        })
      | undefined;
    expect(end?.output?.ok).toBe(true);
    expect(end?.output?.stopReason).toBe("suspended");
    expect(end?.output?.suspended).toBe(true);
  });
});
```

- [ ] **Step 2B.6: Run to verify it fails**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- claude-code-session`
Expected: FAIL — `session.suspend` is not a function; the abort currently produces `agent_end{ ok:false, stopReason:"error" }`.

- [ ] **Step 2B.7: Implement `suspend()` and suspended end in the session**

In `packages/harness-engine-claude-code/src/claude-code-session.ts`, add a `suspended` flag, a `suspend()` method, and branch the `consume()` catch (and natural end) on it:

```typescript
  private suspended = false;

  // ... inside consume():
  private async consume(): Promise<void> {
    try {
      for await (const msg of this.queryGenerator) {
        if (this.aborted) break;
        this.captureSessionId(msg);
        for (const e of this.mapper.map(msg)) {
          for (const h of this.handlers) h(e);
        }
      }
      if (this.suspended) {
        this.emitSuspendedEnd();
      }
    } catch (err) {
      if (this.suspended) {
        // Deliberate durable-await suspend: the query was aborted on purpose
        // after a tool returned executionStatus:suspended. Report a clean
        // suspended end so the server parks the run instead of failing it.
        this.emitSuspendedEnd();
        return;
      }
      const errorEvent = {
        type: "agent_end" as const,
        stepId: this.stepId,
        output: {
          ok: false,
          response: err instanceof Error ? err.message : "Session error",
          stopReason: "error" as const,
        },
      };
      for (const h of this.handlers) h(errorEvent);
    }
  }

  private emitSuspendedEnd(): void {
    const event = {
      type: "agent_end" as const,
      stepId: this.stepId,
      output: {
        ok: true,
        response: "Turn suspended pending awaited workflow completion.",
        stopReason: "suspended" as const,
        suspended: true,
      },
    };
    for (const h of this.handlers) h(event);
  }

  /**
   * Marks this turn as deliberately suspended (durable agent-await). The engine
   * calls this from the SDK tool handler's onTerminate, then aborts the query;
   * consume() then emits a clean suspended agent_end. See kanban-atuq.
   */
  suspend(): void {
    this.suspended = true;
  }
```

If `CanonicalSessionEvent`'s `agent_end` output type (in `packages/core`) rejects `stopReason: "suspended"` / `suspended`, widen it there (add `"suspended"` to the stopReason union and an optional `suspended?: boolean`), rebuild `packages/core`, and note it in the commit.

- [ ] **Step 2B.8: Wire the AbortController + onTerminate in the engine**

In `packages/harness-engine-claude-code/src/claude-code-engine.ts`, create one `AbortController` per session, give `toSdkTool` an `onTerminate` that marks the session suspended and aborts, and pass `abortController` into `query` options. Because the session is constructed after the tools, capture it via a holder:

```typescript
const abortController = new AbortController();
let sessionRef: ClaudeCodeSession | undefined;
const onTerminate = (): void => {
  sessionRef?.suspend();
  abortController.abort();
};
const sdkTools = ctx.toolCatalog.map((spec) =>
  toSdkTool(spec, { onTerminate }),
);
// ... in query options, add:
//   abortController,
// (alongside cwd/systemPrompt/canUseTool/env/...)
// then after constructing the session:
sessionRef = new ClaudeCodeSession(gen, mapper, stepId, {
  resumable: resumeSessionId !== undefined,
});
return sessionRef;
```

Verify the SDK `query` option name for cancellation is `abortController` (the `@anthropic-ai/claude-agent-sdk` `Options` type). If the installed SDK uses `signal`/`abortSignal` instead, pass that key with `abortController.signal`. Confirm by reading the SDK `.d.ts` in `node_modules/@anthropic-ai/claude-agent-sdk` before finalizing.

- [ ] **Step 2B.9: Run the session + engine tests**

Run:

```bash
npm run test --workspace=packages/harness-engine-claude-code
```

Expected: PASS (to-sdk-tool, claude-code-session). Build to typecheck the engine wiring:

```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/harness-engine-claude-code
```

Expected: clean.

- [ ] **Step 2B.10: Commit**

```bash
git add packages/harness-engine-claude-code/src packages/core/src
git commit -m "feat(harness-claude-code): abort+suspend turn on terminate directive (kanban-atuq)"
```

### Task 2C: Runtime server reports `suspended`

**Files:**

- Modify: `packages/harness-runtime/src/server/server.ts` (`subscribeForCompletion`, `executeAgentStep`, `SessionCompletionResult`)
- Read first: `reconcileAgentEndEvent` / `extractTurnError` (same file or a sibling) to extend without breaking masked-end correction.
- Test: `packages/harness-runtime/src/server/server.spec.ts` (create or extend)

- [ ] **Step 2C.1: Read the completion reconciliation helpers**

Read `subscribeForCompletion` (server.ts:248) and `reconcileAgentEndEvent` (find its definition). Confirm where `SessionCompletionResult` is built and returned by `executeAgentStep` (server.ts:216).

- [ ] **Step 2C.2: Write the failing test**

In `server.spec.ts`, drive a fake session that emits `agent_end` with `output.suspended === true` and assert the completion result carries `suspended: true` and `ok: true` (do not assert `error`). Model the test on the existing completion tests in the package (use the same harness/mocks). Concretely, the `finished` promise must resolve to `{ ok: true, suspended: true, response: <text> }`.

- [ ] **Step 2C.3: Run to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- server`
Expected: FAIL — `suspended` absent from `SessionCompletionResult`.

- [ ] **Step 2C.4: Implement suspended propagation**

Extend the interface and the resolve path:

```typescript
interface SessionCompletionResult {
  ok: boolean;
  response: string;
  error?: string;
  suspended?: boolean;
}
```

In `subscribeForCompletion`, when the `agent_end` output has `suspended === true`, resolve `{ ok: true, suspended: true, response }` (bypass the masked-end correction, which only flips `ok` to false). In `executeAgentStep`, thread `suspended` into the return object:

```typescript
return {
  ok: result.ok,
  response: result.response,
  error: result.ok ? undefined : result.error,
  ...(result.suspended ? { suspended: true } : {}),
  ...(producedSessionId ? { producedSessionId } : {}),
};
```

Add `suspended?: boolean` to `executeAgentStep`'s return type.

- [ ] **Step 2C.5: Run + build**

Run: `npm run test --workspace=packages/harness-runtime -- server` → PASS.
Run: `npm run build --workspace=packages/harness-runtime` → clean.

- [ ] **Step 2C.6: Commit**

```bash
git add packages/harness-runtime/src/server
git commit -m "feat(harness-runtime): report suspended turn outcome from executeAgentStep (kanban-atuq)"
```

### Task 2D: API treats a parked/suspended turn as non-failing

**Goal:** A suspended turn produces no `set_job_output`; the API must NOT raise `output_contract.missing` or fail/retry it. The run is already parked (`register()` sets `wait_reason='dependency'`; `handleJobComplete` already no-ops on `wait_reason` — see `workflow-run-job-execution.service.ts:152`). The gap is the **output-contract retry** path and the agent-step completion path, which run before/around `handleJobComplete`.

**Files:**

- Read first: `apps/api/src/workflow/workflow-step-execution/step-required-tool-retry.service.ts` (`checkOutputContractAndRetry`, ~line 75), `step-agent-step-executor.completion.ts`, `step-execution-completion.listener.ts`, and how the harness HTTP result (`apps/api/src/docker/container-http-client.service.ts`) carries `suspended`.
- Modify: the output-contract check to short-circuit when the run is parked.
- Test: `apps/api/src/workflow/workflow-step-execution/step-required-tool-retry.service.spec.ts` (extend) or the relevant completion spec.

- [ ] **Step 2D.1: Confirm the flow and the parked signal**

Read the four files above. Determine the authoritative "is this run parked?" signal available at contract-check time — prefer reading `run.wait_reason` via `runRepo.findById` (already used widely) over plumbing the harness `suspended` flag, because `register()` sets `wait_reason` synchronously during the suspending tool call, so it is reliably set by the time the turn ends. Decide the single guard location (recommended: top of `checkOutputContractAndRetry`).

- [ ] **Step 2D.2: Write the failing test**

In the chosen spec, construct a job with an `output_contract` and a run whose `wait_reason = 'dependency'`. Assert the service does NOT log `output_contract.missing`, does NOT schedule a retry, and does NOT call `handleJobFailed`. Use the existing mock-factory conventions (`testing-unit-patterns` skill) for `runRepo`, `outputContractService`, logger.

- [ ] **Step 2D.3: Run to verify it fails**

Run: `npm run test --workspace=apps/api -- step-required-tool-retry`
Expected: FAIL — the parked run still triggers the missing-contract retry.

- [ ] **Step 2D.4: Implement the parked guard**

At the top of `checkOutputContractAndRetry` (after loading the run), short-circuit when parked:

```typescript
const run = await this.runRepo.findById(workflowRunId);
if (run?.awaiting_input || run?.wait_reason) {
  // The turn ended because the agent durably suspended (await_agent_workflow /
  // delegate_*). A parked run produces no set_job_output by design; enforcing
  // the output contract here would mis-fail it and trigger a retry cascade that
  // re-spawns children. Leave it parked for the dependency-resume path. kanban-atuq.
  this.logger.log(
    `Run ${workflowRunId} parked (wait_reason=${run.wait_reason ?? "awaiting_input"}); skipping output-contract enforcement for ${jobId}`,
  );
  return; // or the service's "no retry" return shape — match the existing signature
}
```

Match the method's existing return type and the names of injected deps (`this.runRepo`, etc.) discovered in 2D.1.

- [ ] **Step 2D.5: Run to verify it passes + full api targeted suites**

Run:

```bash
npm run test --workspace=apps/api -- step-required-tool-retry
npm run test --workspace=apps/api -- workflow-run-job-execution
```

Expected: PASS.

- [ ] **Step 2D.6: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution
git commit -m "fix(api): skip output-contract enforcement for parked/suspended turns (kanban-atuq)"
```

### Task 2E: End-to-end guard (no further tool calls after suspend)

- [ ] **Step 2E.1: Add an engine-level integration test**

In `packages/harness-engine-claude-code`, add a test that feeds a scripted SDK generator: `system` → `assistant`(tool_use await_agent_workflow) → the handler (with a stub `invoke` returning `terminate:true`) calls `onTerminate` → assert the generator is aborted and the session emits exactly one `agent_end{ stopReason:"suspended" }` and NO `tool_execution_start` after the suspend. This locks the "one delegation per turn" behavior the user requires.

- [ ] **Step 2E.2: Run + commit**

Run: `npm run test --workspace=packages/harness-engine-claude-code` → PASS.

```bash
git add packages/harness-engine-claude-code/src
git commit -m "test(harness-claude-code): assert turn halts after suspend directive (kanban-atuq)"
```

---

## Phase 3 — `await_agent_workflow` attach-to-run, no silent default (kanban-deuu)

**Root cause:** `normalizeAwaitTarget` (`workflow-runtime-await-actions.service.ts:150-152`) defaults a missing `workflow_id` to `orchestration_invoke_agent_default`, so a call with no launch target silently spawns a contextless child (the phantom run `2f56e0d7`). The controller (`workflow-runtime-lifecycle.controller.ts:336`) overrides the agent-supplied `workflow_run_id` with the caller's own run id, so the agent has no way to express "await this existing run."

**Design decision (recommended, flagged for review at handoff):** (a) add explicit attach-to-run via an `awaited_run_ids: string[]` (and singular `awaited_run_id`) parameter — when present, register a durable await over those existing, non-terminal runs in the caller's scope **without launching any new workflow**; (b) remove the silent `orchestration_invoke_agent_default` default — when a call resolves to neither a launch target (`workflows[]`/`workflow_id`) nor `awaited_run_ids`, throw `BadRequestException`; (c) update `awaitAgentWorkflowBodySchema` + the tool description so launch-vs-attach is explicit. _Alternative considered:_ drop attach support entirely and rely on `delegate_*` (which already awaits) + Phase 4 prompt fix; rejected because the tool is in the CEO allowlist and named `await_*`, so agents will keep passing run ids — attach is the least-surprising contract.

**Files:**

- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime-await-actions.service.ts`
- Modify: `packages/core/src/schemas/workflow-runtime/workflow-runtime-lifecycle.schema.ts` (`awaitAgentWorkflowBodySchema`)
- Modify: `seed/.../await_agent_workflow` tool description (locate the delegation/runtime tool description seed; `grep -rn "await_agent_workflow" seed`)
- Test: `apps/api/src/workflow/workflow-runtime/workflow-runtime-await-actions.service.spec.ts`

### Task 3A: Remove the silent default (fail closed)

- [ ] **Step 3A.1: Write the failing test**

In `workflow-runtime-await-actions.service.spec.ts`, call `startAwaitedInvocationWorkflows` with only `{ workflow_run_id, step_id, reason }` (no `workflow_id`/`workflows`/`awaited_run_ids`) and assert it rejects with `BadRequestException` and that `workflowEngine.startWorkflow` is NEVER called.

```typescript
it("rejects a call with no launch target and no awaited run ids", async () => {
  await expect(
    service.startAwaitedInvocationWorkflows({
      workflow_run_id: "parent-1",
      step_id: "strategize",
      reason: "x",
    }),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(engine.startWorkflow).not.toHaveBeenCalled();
});
```

- [ ] **Step 3A.2: Run to verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-runtime-await-actions`
Expected: FAIL — today it defaults to `orchestration_invoke_agent_default` and calls `startWorkflow`.

- [ ] **Step 3A.3: Implement fail-closed target resolution**

In `resolveAwaitTargets`, only treat the call as a launch when an explicit `workflow_id` or `workflows[]` is present. Remove the `?? DEFAULT_AGENT_INVOCATION_WORKFLOW_ID` fallback in `normalizeAwaitTarget`; instead, if a target entry has no `workflow_id`, drop it. After resolving both launch targets and attach run ids (Task 3B), if BOTH are empty, the existing guard at line 104 throws — broaden its message to mention `awaited_run_ids`. Keep `DEFAULT_AGENT_INVOCATION_WORKFLOW_ID` only if some explicit caller still legitimately omits an id for a known single-purpose launch; otherwise delete the constant.

- [ ] **Step 3A.4: Run to verify it passes**

Run: `npm run test --workspace=apps/api -- workflow-runtime-await-actions`
Expected: PASS.

- [ ] **Step 3A.5: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime/workflow-runtime-await-actions.service.ts apps/api/src/workflow/workflow-runtime/workflow-runtime-await-actions.service.spec.ts
git commit -m "fix(api): await_agent_workflow no longer silently launches default workflow (kanban-deuu)"
```

### Task 3B: Attach-to-existing-run support

- [ ] **Step 3B.1: Write the failing test**

Assert that `startAwaitedInvocationWorkflows({ workflow_run_id: 'parent-1', step_id: 'strategize', awaited_run_ids: ['child-9'] })` registers an await over `['child-9']`, does NOT call `startWorkflow`, and returns `{ executionStatus: 'suspended', awaitedRunIds: ['child-9'] }`. Add a second test that a terminal or unknown `awaited_run_id` is rejected with `BadRequestException`.

- [ ] **Step 3B.2: Run to verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-runtime-await-actions`
Expected: FAIL — no attach path exists.

- [ ] **Step 3B.3: Implement attach path**

Add a private `resolveAttachRunIds(params)` that normalizes `awaited_run_id`/`awaited_run_ids` to a `string[]`. In `startAwaitedInvocationWorkflows`, before launching: if attach ids are present, validate each via `workflowPersistence.getWorkflowRun(id)` — exists, same scope as parent (`resolveRunScopeNodeId`), and non-terminal — then add them to `awaitedRunIds` without launching. Launch targets (if any) still go through `startAwaitedChildren`. Register the await over the union. (Use the existing `assertResumeCapableEngine` + `register` flow unchanged.)

- [ ] **Step 3B.4: Run to verify it passes**

Run: `npm run test --workspace=apps/api -- workflow-runtime-await-actions`
Expected: PASS.

- [ ] **Step 3B.5: Commit**

```bash
git add apps/api/src/workflow/workflow-runtime/workflow-runtime-await-actions.service.ts apps/api/src/workflow/workflow-runtime/workflow-runtime-await-actions.service.spec.ts
git commit -m "feat(api): await_agent_workflow attaches to existing run ids (kanban-deuu)"
```

### Task 3C: Schema + tool description

- [ ] **Step 3C.1: Update the schema**

In `packages/core/src/schemas/workflow-runtime/workflow-runtime-lifecycle.schema.ts`, add to `awaitAgentWorkflowBodySchema`:

```typescript
    awaited_run_ids: z.array(z.string().trim().min(1)).optional(),
    awaited_run_id: optionalTrimmedNonBlankString,
```

Rebuild core: `npm run build --workspace=packages/core`.

- [ ] **Step 3C.2: Update the tool description**

`grep -rn "await_agent_workflow" seed` to find the runtime tool description; rewrite it to state: "Awaits one or more workflows and suspends the calling step until they finish. Provide `workflows`/`workflow_id` to LAUNCH-and-await new children, OR `awaited_run_ids` to attach to runs you already started (e.g. via `delegate_*`). Do NOT pass `workflow_run_id` (the caller's run is inferred). After a `delegate_*` call you do NOT need to call this — `delegate_*` already suspends and awaits."

- [ ] **Step 3C.3: Validate seed + commit**

Run: `npm run validate:seed-data` → PASS.

```bash
git add packages/core/src seed
git commit -m "docs(core): document await_agent_workflow launch-vs-attach contract (kanban-deuu)"
```

---

## Phase 4 — CEO prompt: do not double-await after `delegate_*` (kanban-4jhn)

**Depends on Phase 2 + Phase 3.** Once suspend is honored, the agent never reaches a redundant await; still, the prompt/playbook should stop instructing a separate await after `delegate_*`, and the `delegate_*` docstrings should state they already suspend-and-await.

**Files:**

- Modify: `seed/agents/ceo-agent/agent.json` (prompt/playbook text and any "after delegating, await" guidance)
- Modify: `seed/workflow-delegation-tools/*.json` (delegate tool descriptions)
- Read first: the CEO system prompt body and the orchestration playbook skills referenced by the agent.

- [ ] **Step 4.1: Locate the instruction**

`grep -n "await" seed/agents/ceo-agent/agent.json` and inspect the orchestration playbook/skill text. Identify where the agent is told to delegate then await.

- [ ] **Step 4.2: Rewrite the guidance**

State explicitly: "`delegate_*` tools already launch the child workflow AND durably suspend this turn until it finishes — its result is delivered when you resume. Issue ONE delegation (or one `await_agent_workflow`) at a time; do NOT call `await_agent_workflow` after a `delegate_*`. Use `await_agent_workflow` with `awaited_run_ids` only to wait on runs you started by other means."

- [ ] **Step 4.3: Update each `delegate_*` tool description**

In `seed/workflow-delegation-tools/*.json`, append to each description: "Launches the child workflow and suspends this turn until it completes (durable await); the result is delivered on resume. No separate await call is needed."

- [ ] **Step 4.4: Validate seed + commit**

Run: `npm run validate:seed-data` → PASS.

```bash
git add seed
git commit -m "fix(seed): stop CEO double-awaiting after delegate_*; document delegate suspends-and-awaits (kanban-4jhn)"
```

---

## Final verification

- [ ] **Step F.1: Build the full affected graph**

```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/harness-runtime
npm run build --workspace=packages/harness-engine-claude-code
npm run build:api
```

Expected: all clean.

- [ ] **Step F.2: Targeted test suites**

```bash
npm run test --workspace=packages/harness-runtime
npm run test --workspace=packages/harness-engine-claude-code
npm run test --workspace=apps/api -- workflow-runtime-await-actions
npm run test --workspace=apps/api -- step-required-tool-retry
npm run test --workspace=apps/api -- workflow-run-job-execution
```

Expected: PASS.

- [ ] **Step F.3: Lint the touched workspaces**

```bash
npm run lint:summary
```

Expected: no new findings in touched files (strict policy — no `eslint-disable`).

- [ ] **Step F.4: Live re-verification (manual, after rebuilding container images)**

Per memory `claude-code-harness-end-to-end`: rebuild `nexus-light`/`nexus-heavy` images so the harness dist changes ship, then launch a CEO Project Orchestration cycle and pull the debug bundle:

```bash
.\.agents\skills\retrieve-debug-bundle\scripts\Get-DebugBundle.ps1 -Id "<new-run-id>"
```

Confirm in the event ledger: (1) after the first `delegate_*`/`await_agent_workflow` the turn ENDS (no further `tool.execution.started` in that step until resume); (2) NO `orchestration_invoke_agent_default` child spawned; (3) no "concurrency policy skipped" 400s; (4) the run resumes after the child reaches terminal with the child result in context; (5) any genuine API 400 now records `outcome=failure`/`isError:true`.

- [ ] **Step F.5: Update docs + close issues**

Update `docs/guide` (durable agent-await section) to describe the end-to-end suspend/resume flow. Then:

```bash
bd close kanban-an5f kanban-atuq kanban-deuu kanban-4jhn --reason="Durable await suspend honored end-to-end; see docs/superpowers/plans/2026-06-14-durable-await-suspend.md"
```

---

## Self-review notes

- **Spec coverage:** Phase 1 → kanban-an5f; Phase 2 → kanban-atuq (api-callback flag, SDK abort, session suspended-end, server report, API parked guard, e2e); Phase 3 → kanban-deuu (no silent default, attach-to-run, schema/description); Phase 4 → kanban-4jhn (prompt + delegate docstrings). All four issues covered.
- **Type consistency:** `terminate` (existing `ToolCallResult` field), `onTerminate` (new `ToSdkToolOptions`), `suspend()`/`suspended` (session), `suspended` (`SessionCompletionResult` + `executeAgentStep` return), `awaited_run_ids`/`awaited_run_id` (schema + service) used consistently across tasks.
- **Open confirmations (flagged inline, resolve during execution, not placeholders):** SDK `query` cancellation option name (`abortController` vs `signal`) — confirm against installed `@anthropic-ai/claude-agent-sdk` `.d.ts` in Step 2B.8; `CanonicalSessionEvent` stopReason union may need widening in `packages/core` (Step 2B.7); exact return shape of `checkOutputContractAndRetry` (Step 2D.1). Each has a read-first step.
- **PI engine:** `packages/pi-runner/src` no longer exists (retired per EPIC-196); only the claude-code engine needs the suspend wiring. If a separate PI harness engine package is later found to be live and resume-capable, mirror Task 2B/2C there.
