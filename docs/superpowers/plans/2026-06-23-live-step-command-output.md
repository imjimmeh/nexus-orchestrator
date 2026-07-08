# Live Step Command Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream a `run_command` step's command and terminal output live to the session view, rendered as per-step collapsible cards.

**Architecture:** The harness runtime spawns the command (instead of buffering it), emitting `command_started` / `command_output` / `command_finished` events over its existing telemetry websocket; the API gateway broadcasts them through the existing Redis telemetry pipeline; the web builds a per-step model keyed by `stepId` and renders a `StepCommandCard`. The buffered HTTP response that determines the step verdict is unchanged.

**Tech Stack:** TypeScript; `@nexus/core` shared types; `packages/harness-runtime` (Node `child_process`, socket.io-client, vitest); NestJS API (`apps/api`, vitest); React + Vite (`apps/web`, vitest).

Spec: `docs/superpowers/specs/2026-06-23-live-step-command-output-design.md`.

## Global Constraints

- **TDD always** — red → green → refactor. No production code without a failing test first.
- **No lint suppression** — never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`. Fix findings in code.
- **Strict typing** — shared cross-layer types live in `@nexus/core`; no `any`.
- **Build `@nexus/core` first** — `npm run build --workspace=packages/core` after changing it; all packages depend on it.
- **Back-compat both directions** — an older API (no `stepId`) and an older harness (no events) must both keep working; the buffered `{ ok, exit_code, stdout, stderr, timed_out }` response is the source of truth for the step verdict and must not change shape.
- **Best-effort emission** — telemetry emission must never block or fail the command.
- Event type string values are exactly: `command_started`, `command_output`, `command_finished`.

---

## File Structure

- `packages/core/src/schemas/harness/command-events.ts` (create) — event-type constants + payload interfaces; re-exported from the core barrel.
- `packages/harness-runtime/src/server/chunk-batcher.ts` (create) — pure batching helper.
- `packages/harness-runtime/src/server/server.ts` (modify) — `defaultExecuteCommand` streams + emits; `ExecuteCommandRequest` gains `stepId`; route wires an emit callback.
- `apps/api/src/docker/container-http-client.service.ts` (modify) — `ContainerCommandRequest` gains `stepId`.
- `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.ts` (modify) — pass `stepId: step.id`.
- `apps/api/src/telemetry/command-output-gateway.helpers.ts` (create) — compat helpers for the three events (persist policy).
- `apps/api/src/telemetry/telemetry.gateway.ts` (modify) — three `@SubscribeMessage` handlers.
- `apps/web/src/lib/api/types.ts` (modify) — add the three event types to the union.
- `apps/web/src/pages/active-session/step-command-model.ts` (create) — pure per-step model builder.
- `apps/web/src/components/sessions/StepCommandCard.tsx` (create) — the card component.
- `apps/web/src/pages/active-session/active-session.chat-builder.handlers.command.ts` (create) + `active-session.chat-builder.event-map.ts` (modify) — wire events into the timeline.
- Docs: `docs/guide/42-execution-lifecycle.md` (modify).

---

## Task 1: Core command-event contract

**Files:**

- Create: `packages/core/src/schemas/harness/command-events.ts`
- Modify: `packages/core/src/index.ts` (add the re-export next to other harness schema exports)
- Test: `packages/core/src/schemas/harness/command-events.spec.ts`

**Interfaces:**

- Produces:
  - `COMMAND_STARTED_EVENT = 'command_started'`, `COMMAND_OUTPUT_EVENT = 'command_output'`, `COMMAND_FINISHED_EVENT = 'command_finished'`
  - `interface CommandStartedPayload { stepId: string; command: string }`
  - `interface CommandOutputPayload { stepId: string; stream: 'stdout' | 'stderr'; chunk: string; seq: number }`
  - `interface CommandFinishedPayload { stepId: string; exitCode: number; timedOut: boolean; ok: boolean; outputTail: string }`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/schemas/harness/command-events.spec.ts
import { describe, expect, it } from "vitest";
import {
  COMMAND_STARTED_EVENT,
  COMMAND_OUTPUT_EVENT,
  COMMAND_FINISHED_EVENT,
  type CommandOutputPayload,
} from "./command-events";

describe("command events contract", () => {
  it("exposes stable event-type string constants", () => {
    expect(COMMAND_STARTED_EVENT).toBe("command_started");
    expect(COMMAND_OUTPUT_EVENT).toBe("command_output");
    expect(COMMAND_FINISHED_EVENT).toBe("command_finished");
  });

  it("types a command_output payload with an ordering seq", () => {
    const payload: CommandOutputPayload = {
      stepId: "run_gate",
      stream: "stdout",
      chunk: "PASS\n",
      seq: 3,
    };
    expect(payload.seq).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- command-events.spec.ts --run`
Expected: FAIL — `Cannot find module './command-events'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/schemas/harness/command-events.ts

/** Telemetry events that stream a run_command step's terminal output live. */
export const COMMAND_STARTED_EVENT = "command_started" as const;
export const COMMAND_OUTPUT_EVENT = "command_output" as const;
export const COMMAND_FINISHED_EVENT = "command_finished" as const;

export interface CommandStartedPayload {
  stepId: string;
  command: string;
}

export interface CommandOutputPayload {
  stepId: string;
  stream: "stdout" | "stderr";
  chunk: string;
  /** Per-step monotonically increasing index for ordering and de-duplication. */
  seq: number;
}

export interface CommandFinishedPayload {
  stepId: string;
  exitCode: number;
  timedOut: boolean;
  ok: boolean;
  /** Last bytes of combined output, persisted so late replay viewers see a tail. */
  outputTail: string;
}
```

- [ ] **Step 4: Re-export from the core barrel**

Open `packages/core/src/index.ts`, find where other `schemas/harness/*` modules are re-exported, and add:

```typescript
export * from "./schemas/harness/command-events";
```

- [ ] **Step 5: Run test + build core**

Run: `npm run test --workspace=packages/core -- command-events.spec.ts --run`
Expected: PASS.
Run: `npm run build --workspace=packages/core`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/harness/command-events.ts packages/core/src/schemas/harness/command-events.spec.ts packages/core/src/index.ts
git commit -m "feat(core): add live command-output telemetry event contract"
```

---

## Task 2: Harness ChunkBatcher

**Files:**

- Create: `packages/harness-runtime/src/server/chunk-batcher.ts`
- Test: `packages/harness-runtime/src/server/chunk-batcher.spec.ts`

**Interfaces:**

- Produces:
  - `class ChunkBatcher` with constructor `(onFlush: (text: string) => void, options?: { maxBytes?: number; flushIntervalMs?: number })`
  - methods: `push(text: string): void`, `flush(): void`, `stop(): void`
  - defaults: `DEFAULT_BATCH_MAX_BYTES = 4096`, `DEFAULT_BATCH_FLUSH_MS = 250`

Batches text and calls `onFlush` with the coalesced string when buffered bytes reach `maxBytes` or when the flush timer fires; `flush()` forces an immediate emit; `stop()` clears the timer. Never emits empty strings.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/harness-runtime/src/server/chunk-batcher.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChunkBatcher } from "./chunk-batcher";

describe("ChunkBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces pushes and flushes on the interval", () => {
    const onFlush = vi.fn();
    const batcher = new ChunkBatcher(onFlush, {
      flushIntervalMs: 250,
      maxBytes: 1_000,
    });
    batcher.push("a");
    batcher.push("b");
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onFlush).toHaveBeenCalledExactlyOnceWith("ab");
  });

  it("flushes immediately when buffered bytes exceed maxBytes", () => {
    const onFlush = vi.fn();
    const batcher = new ChunkBatcher(onFlush, {
      flushIntervalMs: 10_000,
      maxBytes: 3,
    });
    batcher.push("abcd");
    expect(onFlush).toHaveBeenCalledExactlyOnceWith("abcd");
  });

  it("flush() emits buffered text once and stop() prevents further timer flushes", () => {
    const onFlush = vi.fn();
    const batcher = new ChunkBatcher(onFlush, {
      flushIntervalMs: 250,
      maxBytes: 1_000,
    });
    batcher.push("x");
    batcher.flush();
    expect(onFlush).toHaveBeenCalledExactlyOnceWith("x");
    batcher.stop();
    batcher.push("y");
    vi.advanceTimersByTime(1_000);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("never emits an empty flush", () => {
    const onFlush = vi.fn();
    const batcher = new ChunkBatcher(onFlush, { flushIntervalMs: 250 });
    batcher.flush();
    vi.advanceTimersByTime(250);
    expect(onFlush).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- chunk-batcher.spec.ts --run`
Expected: FAIL — `Cannot find module './chunk-batcher'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/harness-runtime/src/server/chunk-batcher.ts

export const DEFAULT_BATCH_MAX_BYTES = 4096;
export const DEFAULT_BATCH_FLUSH_MS = 250;

/**
 * Coalesces a stream of text pushes into batched flushes to cap telemetry event
 * volume from noisy commands (e.g. a full test suite) while staying visibly live.
 * Flushes when buffered bytes reach `maxBytes` or on the `flushIntervalMs` timer.
 */
export class ChunkBatcher {
  private buffer = "";
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onFlush: (text: string) => void,
    private readonly options: {
      maxBytes?: number;
      flushIntervalMs?: number;
    } = {},
  ) {
    const intervalMs = options.flushIntervalMs ?? DEFAULT_BATCH_FLUSH_MS;
    this.timer = setInterval(() => this.flush(), intervalMs);
  }

  push(text: string): void {
    if (!text) return;
    this.buffer += text;
    const maxBytes = this.options.maxBytes ?? DEFAULT_BATCH_MAX_BYTES;
    if (Buffer.byteLength(this.buffer, "utf-8") >= maxBytes) {
      this.flush();
    }
  }

  flush(): void {
    if (!this.buffer) return;
    const text = this.buffer;
    this.buffer = "";
    this.onFlush(text);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/harness-runtime -- chunk-batcher.spec.ts --run`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/harness-runtime/src/server/chunk-batcher.ts packages/harness-runtime/src/server/chunk-batcher.spec.ts
git commit -m "feat(harness): add ChunkBatcher for batched command-output emission"
```

---

## Task 3: Harness streams command output

**Files:**

- Modify: `packages/harness-runtime/src/server/server.ts` (`ExecuteCommandRequest` ~line 46; `defaultExecuteCommand` ~lines 84-130; `handleExecuteCommandRoute` ~lines 258-300)
- Test: `packages/harness-runtime/src/server/execute-command-streaming.spec.ts`

**Interfaces:**

- Consumes: `ChunkBatcher` (Task 2); `COMMAND_*` constants + payloads (Task 1).
- Produces: `defaultExecuteCommand(request, defaultWorkingDir, emit?)` where `emit?: (event: string, data: unknown) => void`. Streams `command_started` once, batched `command_output` events (with monotonically increasing `seq`), and one `command_finished` (with `outputTail`, last 16 KB of combined output). Still resolves the unchanged `{ ok, exit_code, stdout, stderr, timed_out }`. `ExecuteCommandRequest` gains `stepId?: string`; when absent or `emit` is undefined, no events are emitted (back-compat).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/harness-runtime/src/server/execute-command-streaming.spec.ts
import { describe, expect, it } from "vitest";
import { defaultExecuteCommand } from "./server";

interface Emitted {
  event: string;
  data: Record<string, unknown>;
}

function collect(): {
  emit: (e: string, d: unknown) => void;
  events: Emitted[];
} {
  const events: Emitted[] = [];
  return {
    emit: (event, data) =>
      events.push({ event, data: data as Record<string, unknown> }),
    events,
  };
}

describe("defaultExecuteCommand streaming", () => {
  it("emits started, output, and finished events for a successful command", async () => {
    const { emit, events } = collect();
    const result = await defaultExecuteCommand(
      { command: 'printf "hello\\n"', stepId: "run_gate" },
      process.cwd(),
      emit,
    );

    expect(result.ok).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("hello");

    const types = events.map((e) => e.event);
    expect(types[0]).toBe("command_started");
    expect(types).toContain("command_output");
    expect(types[types.length - 1]).toBe("command_finished");

    const started = events.find((e) => e.event === "command_started");
    expect(started?.data).toMatchObject({
      stepId: "run_gate",
      command: 'printf "hello\\n"',
    });

    const finished = events.find((e) => e.event === "command_finished");
    expect(finished?.data).toMatchObject({
      stepId: "run_gate",
      exitCode: 0,
      timedOut: false,
      ok: true,
    });
    expect(String(finished?.data.outputTail)).toContain("hello");

    const outputs = events.filter((e) => e.event === "command_output");
    const seqs = outputs.map((e) => e.data.seq as number);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(String(outputs.map((e) => e.data.chunk).join(""))).toContain(
      "hello",
    );
  });

  it("reports a non-zero exit code and still returns buffered output", async () => {
    const { emit, events } = collect();
    const result = await defaultExecuteCommand(
      { command: 'printf "boom\\n" 1>&2; exit 3', stepId: "run_gate" },
      process.cwd(),
      emit,
    );

    expect(result.ok).toBe(false);
    expect(result.exit_code).toBe(3);
    expect(result.stderr).toContain("boom");
    const finished = events.find((e) => e.event === "command_finished");
    expect(finished?.data).toMatchObject({ exitCode: 3, ok: false });
  });

  it("emits nothing when no emit callback is provided (back-compat)", async () => {
    const result = await defaultExecuteCommand(
      { command: 'printf "hi"' },
      process.cwd(),
    );
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("hi");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- execute-command-streaming.spec.ts --run`
Expected: FAIL — `defaultExecuteCommand` currently takes 2 args and emits nothing (no `command_started` in events).

- [ ] **Step 3: Write minimal implementation**

In `server.ts`: add imports at the top:

```typescript
import { spawn } from "node:child_process";
import { ChunkBatcher } from "./chunk-batcher.js";
import {
  COMMAND_STARTED_EVENT,
  COMMAND_OUTPUT_EVENT,
  COMMAND_FINISHED_EVENT,
} from "@nexus/core";
```

Extend the request type (~line 46):

```typescript
interface ExecuteCommandRequest {
  command: string;
  timeoutMs?: number;
  workingDir?: string;
  stepId?: string;
}
```

Replace `defaultExecuteCommand` (lines 84-130) with a streaming implementation. Keep `execFileAsync`/`promisify(execFile)` imports only if still used elsewhere; otherwise remove the now-dead `execFile` import.

```typescript
const OUTPUT_TAIL_MAX_CHARS = 16_384;
type CommandEmit = (event: string, data: unknown) => void;

export async function defaultExecuteCommand(
  request: ExecuteCommandRequest,
  defaultWorkingDir: string,
  emit?: CommandEmit,
): Promise<{
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}> {
  const timeoutMs = Math.min(
    Math.max(request.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, 1),
    MAX_COMMAND_TIMEOUT_MS,
  );
  const cwd = request.workingDir ?? defaultWorkingDir;
  const stepId = request.stepId;
  const canEmit = Boolean(emit && stepId);

  let seq = 0;
  const emitChunk = (stream: "stdout" | "stderr") => (text: string) => {
    if (!canEmit) return;
    emit!(COMMAND_OUTPUT_EVENT, { stepId, stream, chunk: text, seq: seq++ });
  };
  const stdoutBatcher = new ChunkBatcher(emitChunk("stdout"));
  const stderrBatcher = new ChunkBatcher(emitChunk("stderr"));

  let stdout = "";
  let stderr = "";
  const tail = (): string => (stdout + stderr).slice(-OUTPUT_TAIL_MAX_CHARS);

  if (canEmit) {
    emit!(COMMAND_STARTED_EVENT, { stepId, command: request.command });
  }

  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", request.command], {
      cwd,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });

    child.stdout?.on("data", (buf: Buffer) => {
      const text = buf.toString("utf-8");
      stdout += text;
      stdoutBatcher.push(text);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const text = buf.toString("utf-8");
      stderr += text;
      stderrBatcher.push(text);
    });

    const finish = (exitCode: number, timedOut: boolean) => {
      stdoutBatcher.flush();
      stderrBatcher.flush();
      stdoutBatcher.stop();
      stderrBatcher.stop();
      const ok = exitCode === 0 && !timedOut;
      if (canEmit) {
        emit!(COMMAND_FINISHED_EVENT, {
          stepId,
          exitCode,
          timedOut,
          ok,
          outputTail: tail(),
        });
      }
      resolve({
        ok,
        exit_code: exitCode,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        timed_out: timedOut,
      });
    };

    child.on("error", () => finish(1, false));
    child.on("close", (code, signal) => {
      const timedOut = signal === "SIGKILL";
      finish(typeof code === "number" ? code : 1, timedOut);
    });
  });
}
```

Then wire the route (`handleExecuteCommandRoute`, ~line 291) to pass an emit callback bound to the connected client:

```typescript
result = await defaultExecuteCommand(
  body,
  deps.envConfig.workspacePath,
  (event, data) => deps.client.emit(event, data),
);
```

(Leave the `deps.engine.executeCommand` branch unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/harness-runtime -- execute-command-streaming.spec.ts --run`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full harness suite + typecheck**

Run: `npm run test --workspace=packages/harness-runtime --run`
Run: `npm run build --workspace=packages/harness-runtime`
Expected: all pass; no unused-import lint errors (remove `execFile`/`execFileAsync` if no longer used).

- [ ] **Step 6: Commit**

```bash
git add packages/harness-runtime/src/server/server.ts packages/harness-runtime/src/server/execute-command-streaming.spec.ts
git commit -m "feat(harness): stream run_command output as live telemetry events"
```

---

## Task 4: API forwards stepId to the harness

**Files:**

- Modify: `apps/api/src/docker/container-http-client.service.ts` (`ContainerCommandRequest` type)
- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.ts` (`executeCommandStepOnContainer`, ~lines 547-556)
- Test: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.spec.ts` (extend existing)

**Interfaces:**

- Consumes: existing `deps.containerHttpClient.executeCommand(baseUrl, request)`.
- Produces: the `executeCommand` request now includes `stepId: step.id`.

- [ ] **Step 1: Write the failing test** (add to the existing `describe('executeJobCore')`)

```typescript
it("forwards the step id to the container so output can be attributed", async () => {
  const deps = makeDeps();
  const data = makeData({
    job: makeJob({
      steps: [
        {
          id: "run_gate",
          type: "run_command",
          command: "npm test",
          working_dir: "/workspace",
          timeout_ms: 10000,
        },
      ],
    }),
  });

  await executeJobCore({
    data,
    bullJobId: "b1",
    stateVariables: {},
    resolvedJobInputs: {},
    deps,
  });

  expect(
    (deps.containerHttpClient as Record<string, ReturnType<typeof vi.fn>>)
      .executeCommand,
  ).toHaveBeenCalledWith("http://172.17.0.5:8374", {
    command: "npm test",
    timeoutMs: 10000,
    workingDir: "/workspace",
    stepId: "run_gate",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- step-agent-step-executor.multistep.spec.ts -t "forwards the step id" --run`
Expected: FAIL — call made without `stepId`.

- [ ] **Step 3: Write minimal implementation**

In `container-http-client.service.ts`, add `stepId?: string;` to the `ContainerCommandRequest` interface.

In `step-agent-step-executor.multistep.ts`, `executeCommandStepOnContainer`, add `stepId` to the request:

```typescript
deps.containerHttpClient.executeCommand(baseUrl, {
  command,
  timeoutMs: step.timeout_ms,
  workingDir: step.working_dir,
  stepId: step.id,
}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- step-agent-step-executor.multistep.spec.ts --run`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/docker/container-http-client.service.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.spec.ts
git commit -m "feat(api): forward stepId to the container command endpoint"
```

---

## Task 5: API gateway broadcasts command events

**Files:**

- Create: `apps/api/src/telemetry/command-output-gateway.helpers.ts`
- Test: `apps/api/src/telemetry/command-output-gateway.helpers.spec.ts`
- Modify: `apps/api/src/telemetry/telemetry.gateway.ts` (add three handlers next to `handleAgentError`, ~line 249)

**Interfaces:**

- Consumes: the connected `AuthenticatedSocket` (carries `workflowRunId`); `RedisStreamService`, `RedisPubSubService` (mirror `processAndBroadcastEventCompat` in `telemetry-gateway-compat.helpers.ts`).
- Produces:
  - `handleCommandStartedGatewayCompat`, `handleCommandFinishedGatewayCompat` — persist (stream) **and** publish (pubsub).
  - `handleCommandOutputGatewayCompat` — publish (pubsub) only; **not** persisted, to protect the 10k-capped replay stream from a noisy suite. Replay viewers see `command_started` + `command_finished.outputTail` + status.
  - Each helper takes `{ client, payload, streamService, pubsubService }` and resolves the run id from `client` the same way the existing compat handlers do (read how `processAndBroadcastEvent` is bound in `telemetry.gateway.ts` and what context it reads from `client`).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/telemetry/command-output-gateway.helpers.spec.ts
import { describe, expect, it, vi } from "vitest";
import {
  handleCommandStartedGatewayCompat,
  handleCommandOutputGatewayCompat,
  handleCommandFinishedGatewayCompat,
} from "./command-output-gateway.helpers";

function deps() {
  return {
    streamService: { persistEvent: vi.fn().mockResolvedValue(undefined) },
    pubsubService: { publishEvent: vi.fn().mockResolvedValue(undefined) },
  };
}
const RUN = "run-1";

describe("command output gateway compat", () => {
  it("persists and publishes command_started", async () => {
    const d = deps();
    await handleCommandStartedGatewayCompat({
      workflowRunId: RUN,
      payload: { stepId: "run_gate", command: "npm test" },
      ...d,
    } as never);
    expect(d.streamService.persistEvent).toHaveBeenCalledOnce();
    expect(d.pubsubService.publishEvent).toHaveBeenCalledOnce();
  });

  it("publishes command_output live but does NOT persist it to the replay stream", async () => {
    const d = deps();
    await handleCommandOutputGatewayCompat({
      workflowRunId: RUN,
      payload: {
        stepId: "run_gate",
        stream: "stdout",
        chunk: "PASS\n",
        seq: 1,
      },
      ...d,
    } as never);
    expect(d.pubsubService.publishEvent).toHaveBeenCalledOnce();
    expect(d.streamService.persistEvent).not.toHaveBeenCalled();
  });

  it("persists and publishes command_finished", async () => {
    const d = deps();
    await handleCommandFinishedGatewayCompat({
      workflowRunId: RUN,
      payload: {
        stepId: "run_gate",
        exitCode: 0,
        timedOut: false,
        ok: true,
        outputTail: "PASS",
      },
      ...d,
    } as never);
    expect(d.streamService.persistEvent).toHaveBeenCalledOnce();
    expect(d.pubsubService.publishEvent).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- command-output-gateway.helpers.spec.ts --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/telemetry/command-output-gateway.helpers.ts
import type { RedisPubSubService } from "../redis/redis-pubsub.service";
import type { RedisStreamService } from "../redis/redis-stream.service";
import {
  COMMAND_STARTED_EVENT,
  COMMAND_OUTPUT_EVENT,
  COMMAND_FINISHED_EVENT,
} from "@nexus/core";

interface PersistedDeps {
  workflowRunId: string;
  payload: Record<string, unknown>;
  streamService: Pick<RedisStreamService, "persistEvent">;
  pubsubService: Pick<RedisPubSubService, "publishEvent">;
}

function buildEvent(event_type: string, payload: Record<string, unknown>) {
  return { event_type, payload, timestamp: new Date().toISOString() };
}

export async function handleCommandStartedGatewayCompat(
  deps: PersistedDeps,
): Promise<void> {
  const event = buildEvent(COMMAND_STARTED_EVENT, deps.payload);
  await deps.streamService.persistEvent(deps.workflowRunId, event);
  await deps.pubsubService.publishEvent(deps.workflowRunId, event);
}

export async function handleCommandFinishedGatewayCompat(
  deps: PersistedDeps,
): Promise<void> {
  const event = buildEvent(COMMAND_FINISHED_EVENT, deps.payload);
  await deps.streamService.persistEvent(deps.workflowRunId, event);
  await deps.pubsubService.publishEvent(deps.workflowRunId, event);
}

// Publish-only: high-volume chunks must not evict other events from the capped
// replay stream. Replay viewers reconstruct from command_started + command_finished.
export async function handleCommandOutputGatewayCompat(
  deps: PersistedDeps,
): Promise<void> {
  const event = buildEvent(COMMAND_OUTPUT_EVENT, deps.payload);
  await deps.pubsubService.publishEvent(deps.workflowRunId, event);
}
```

- [ ] **Step 4: Run helper test to verify it passes**

Run: `npm run test --workspace=apps/api -- command-output-gateway.helpers.spec.ts --run`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the gateway handlers**

In `telemetry.gateway.ts`, after `handleAgentError` (~line 260), add three handlers. Resolve `workflowRunId` from the socket exactly as the neighbouring handlers do (inspect how `processAndBroadcastEvent` obtains the run id from `client` — reuse that accessor; do not invent a new one). Inject `this.streamService` / `this.pubsubService` (already constructor-injected for the compat path — confirm the property names and reuse them).

```typescript
@SubscribeMessage('command_started')
async handleCommandStarted(
  @ConnectedSocket() client: AuthenticatedSocket,
  @MessageBody() payload: Record<string, unknown>,
) {
  await handleCommandStartedGatewayCompat({
    workflowRunId: this.resolveRunId(client),
    payload,
    streamService: this.streamService,
    pubsubService: this.pubsubService,
  });
}

@SubscribeMessage('command_output')
async handleCommandOutput(
  @ConnectedSocket() client: AuthenticatedSocket,
  @MessageBody() payload: Record<string, unknown>,
) {
  await handleCommandOutputGatewayCompat({
    workflowRunId: this.resolveRunId(client),
    payload,
    streamService: this.streamService,
    pubsubService: this.pubsubService,
  });
}

@SubscribeMessage('command_finished')
async handleCommandFinished(
  @ConnectedSocket() client: AuthenticatedSocket,
  @MessageBody() payload: Record<string, unknown>,
) {
  await handleCommandFinishedGatewayCompat({
    workflowRunId: this.resolveRunId(client),
    payload,
    streamService: this.streamService,
    pubsubService: this.pubsubService,
  });
}
```

Note: `this.resolveRunId(client)` is a stand-in — replace it with the actual run-id accessor used by the existing handlers in this file (find how, e.g., `handleAgentTelemetry` → `handleAgentTelemetryGatewayCompat` derives the run id from `client`, and use the identical mechanism). Add the import for the three helpers.

- [ ] **Step 6: Typecheck + run the telemetry gateway tests**

Run: `npm run build:api`
Run: `npm run test --workspace=apps/api -- telemetry --run`
Expected: build clean; telemetry tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/telemetry/command-output-gateway.helpers.ts apps/api/src/telemetry/command-output-gateway.helpers.spec.ts apps/api/src/telemetry/telemetry.gateway.ts
git commit -m "feat(api): broadcast live command-output telemetry events to web clients"
```

---

## Task 6: Web per-step command model builder

**Files:**

- Modify: `apps/web/src/lib/api/types.ts` (add the three event types to the `WorkflowTelemetryEvent['event_type']` union — find the union and append `'command_started' | 'command_output' | 'command_finished'`)
- Create: `apps/web/src/pages/active-session/step-command-model.ts`
- Test: `apps/web/src/pages/active-session/step-command-model.spec.ts`

**Interfaces:**

- Consumes: `WorkflowTelemetryEvent { event_type: string; payload: Record<string, unknown>; timestamp: string }`.
- Produces:
  - `interface StepCommandModel { stepId: string; command: string; output: string; status: 'running' | 'exited' | 'timed_out'; exitCode: number | null }`
  - `buildStepCommandModels(events: WorkflowTelemetryEvent[]): StepCommandModel[]` — one model per `stepId`, output assembled from `command_output` chunks ordered by `seq` (falling back to `command_finished.outputTail` when no live chunks were seen), status from `command_finished`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/pages/active-session/step-command-model.spec.ts
import { describe, expect, it } from "vitest";
import { buildStepCommandModels } from "./step-command-model";

const ev = (event_type: string, payload: Record<string, unknown>) => ({
  event_type,
  payload,
  timestamp: "2026-06-23T00:00:00.000Z",
});

describe("buildStepCommandModels", () => {
  it("assembles a running command from started + ordered output chunks", () => {
    const models = buildStepCommandModels([
      ev("command_started", { stepId: "run_gate", command: "npm test" }),
      ev("command_output", {
        stepId: "run_gate",
        stream: "stdout",
        chunk: "B",
        seq: 1,
      }),
      ev("command_output", {
        stepId: "run_gate",
        stream: "stdout",
        chunk: "A",
        seq: 0,
      }),
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      stepId: "run_gate",
      command: "npm test",
      output: "AB",
      status: "running",
      exitCode: null,
    });
  });

  it("finalizes status and exit code from command_finished", () => {
    const models = buildStepCommandModels([
      ev("command_started", { stepId: "s", command: "x" }),
      ev("command_output", {
        stepId: "s",
        stream: "stdout",
        chunk: "hi",
        seq: 0,
      }),
      ev("command_finished", {
        stepId: "s",
        exitCode: 2,
        timedOut: false,
        ok: false,
        outputTail: "hi",
      }),
    ]);
    expect(models[0]).toMatchObject({
      status: "exited",
      exitCode: 2,
      output: "hi",
    });
  });

  it("falls back to outputTail when no live chunks were received (replay)", () => {
    const models = buildStepCommandModels([
      ev("command_started", { stepId: "s", command: "x" }),
      ev("command_finished", {
        stepId: "s",
        exitCode: 0,
        timedOut: false,
        ok: true,
        outputTail: "TAIL",
      }),
    ]);
    expect(models[0]).toMatchObject({
      output: "TAIL",
      status: "exited",
      exitCode: 0,
    });
  });

  it("marks a timed-out command", () => {
    const models = buildStepCommandModels([
      ev("command_started", { stepId: "s", command: "x" }),
      ev("command_finished", {
        stepId: "s",
        exitCode: 1,
        timedOut: true,
        ok: false,
        outputTail: "",
      }),
    ]);
    expect(models[0].status).toBe("timed_out");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit:web -- step-command-model.spec.ts --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/src/pages/active-session/step-command-model.ts
import type { WorkflowTelemetryEvent } from "@/lib/api/types";

export interface StepCommandModel {
  stepId: string;
  command: string;
  output: string;
  status: "running" | "exited" | "timed_out";
  exitCode: number | null;
}

interface Acc {
  stepId: string;
  command: string;
  chunks: { seq: number; chunk: string }[];
  tail: string;
  status: "running" | "exited" | "timed_out";
  exitCode: number | null;
  order: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export function buildStepCommandModels(
  events: WorkflowTelemetryEvent[],
): StepCommandModel[] {
  const byStep = new Map<string, Acc>();
  let order = 0;

  const get = (stepId: string): Acc => {
    let acc = byStep.get(stepId);
    if (!acc) {
      acc = {
        stepId,
        command: "",
        chunks: [],
        tail: "",
        status: "running",
        exitCode: null,
        order: order++,
      };
      byStep.set(stepId, acc);
    }
    return acc;
  };

  for (const event of events) {
    const p = event.payload as Record<string, unknown>;
    const stepId = str(p.stepId);
    if (!stepId) continue;
    if (event.event_type === "command_started") {
      get(stepId).command = str(p.command);
    } else if (event.event_type === "command_output") {
      get(stepId).chunks.push({ seq: num(p.seq) ?? 0, chunk: str(p.chunk) });
    } else if (event.event_type === "command_finished") {
      const acc = get(stepId);
      acc.tail = str(p.outputTail);
      acc.exitCode = num(p.exitCode);
      acc.status = p.timedOut === true ? "timed_out" : "exited";
    }
  }

  return [...byStep.values()]
    .sort((a, b) => a.order - b.order)
    .map((acc) => {
      const live = [...acc.chunks]
        .sort((a, b) => a.seq - b.seq)
        .map((c) => c.chunk)
        .join("");
      return {
        stepId: acc.stepId,
        command: acc.command,
        output: live.length > 0 ? live : acc.tail,
        status: acc.status,
        exitCode: acc.exitCode,
      };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit:web -- step-command-model.spec.ts --run`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/types.ts apps/web/src/pages/active-session/step-command-model.ts apps/web/src/pages/active-session/step-command-model.spec.ts
git commit -m "feat(web): build per-step command model from live command events"
```

---

## Task 7: Web StepCommandCard + timeline wiring

**Files:**

- Create: `apps/web/src/components/sessions/StepCommandCard.tsx`
- Test: `apps/web/src/components/sessions/StepCommandCard.spec.tsx`
- Create: `apps/web/src/pages/active-session/active-session.chat-builder.handlers.command.ts`
- Modify: `apps/web/src/pages/active-session/active-session.chat-builder.event-map.ts` (register the three events)
- Modify: `apps/web/src/pages/active-session/active-session.chat-builder.types.ts` (add a `command_card` chat item variant) and `ChatMessageItem.tsx` (render it) — follow exactly how `handleToolEvent` adds and renders a tool chat item.

**Interfaces:**

- Consumes: `StepCommandModel` + `buildStepCommandModels` (Task 6); `EventHandler` type and the chat-builder item model (read `active-session.chat-builder.handlers.tool.ts` for the exact pattern — how a handler appends/updates a keyed chat item).
- Produces: a `StepCommandCard` React component and a `command_card` chat item that appears on `command_started`, updates on `command_output`, finalizes on `command_finished`.

- [ ] **Step 1: Write the failing component test**

```tsx
// apps/web/src/components/sessions/StepCommandCard.spec.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepCommandCard } from "./StepCommandCard";

describe("StepCommandCard", () => {
  it("renders the command, output, and a running status", () => {
    render(
      <StepCommandCard
        model={{
          stepId: "run_gate",
          command: "npm test",
          output: "PASS\n",
          status: "running",
          exitCode: null,
        }}
      />,
    );
    expect(screen.getByText(/npm test/)).toBeInTheDocument();
    expect(screen.getByText(/PASS/)).toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it("shows a non-zero exit code when the command failed", () => {
    render(
      <StepCommandCard
        model={{
          stepId: "run_gate",
          command: "npm test",
          output: "boom",
          status: "exited",
          exitCode: 2,
        }}
      />,
    );
    expect(screen.getByText(/exit 2/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit:web -- StepCommandCard.spec.tsx --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/src/components/sessions/StepCommandCard.tsx
import { useState } from "react";
import type { StepCommandModel } from "@/pages/active-session/step-command-model";

const STATUS_LABEL: Record<StepCommandModel["status"], string> = {
  running: "running",
  exited: "exited",
  timed_out: "timed out",
};

export function StepCommandCard({
  model,
}: {
  model: StepCommandModel;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(model.status !== "running");
  const statusText =
    model.status === "exited" && model.exitCode !== null
      ? `exit ${model.exitCode}`
      : STATUS_LABEL[model.status];

  return (
    <div className="rounded border border-slate-700 bg-slate-900/60 text-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left font-mono"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="truncate text-slate-200">$ {model.command}</span>
        <span className="ml-2 shrink-0 text-xs text-slate-400">
          {statusText}
        </span>
      </button>
      {!collapsed && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-slate-700 px-3 py-2 font-mono text-xs text-slate-300">
          {model.output}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `npm run test:unit:web -- StepCommandCard.spec.tsx --run`
Expected: PASS (2 tests). (Note: a finished card defaults to collapsed; the second test asserts the header status `exit 2`, which is always visible.)

- [ ] **Step 5: Wire the events into the chat builder**

Read `apps/web/src/pages/active-session/active-session.chat-builder.handlers.tool.ts` to learn the exact chat-item shape and how a keyed item is appended/updated. Then create `active-session.chat-builder.handlers.command.ts` exporting `handleCommandEvent: EventHandler` that:

- maintains a `command_card` chat item keyed by `stepId`,
- recomputes its `StepCommandModel` via `buildStepCommandModels` over the run's command events (or updates incrementally following the tool-handler pattern),
- inserts the item at the position of the `command_started` event in timeline order.

Register in `active-session.chat-builder.event-map.ts`:

```typescript
command_started: handleCommandEvent,
command_output: handleCommandEvent,
command_finished: handleCommandEvent,
```

Add a `command_card` variant to the chat item union in `active-session.chat-builder.types.ts`, and in `ChatMessageItem.tsx` render `<StepCommandCard model={item.model} />` for that variant (mirror how the tool item variant is rendered).

- [ ] **Step 6: Add a chat-builder integration test**

In `apps/web/src/pages/active-session/active-session.chat-builder.spec.ts`, add a test that feeds `command_started` + `command_output` + `command_finished` for one `stepId` through the builder and asserts a single `command_card` item is produced with the expected `command` and `output`. (Follow the existing tool-event test in that file for the builder invocation shape.)

- [ ] **Step 7: Run web unit tests + typecheck**

Run: `npm run test:unit:web -- active-session.chat-builder StepCommandCard step-command-model --run`
Run: `npm run build:web`
Expected: all pass; build clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/sessions/StepCommandCard.tsx apps/web/src/components/sessions/StepCommandCard.spec.tsx apps/web/src/pages/active-session/active-session.chat-builder.handlers.command.ts apps/web/src/pages/active-session/active-session.chat-builder.event-map.ts apps/web/src/pages/active-session/active-session.chat-builder.types.ts apps/web/src/components/sessions/ChatMessageItem.tsx apps/web/src/pages/active-session/active-session.chat-builder.spec.ts
git commit -m "feat(web): render live per-step command cards in the session timeline"
```

---

## Task 8: Documentation

**Files:**

- Modify: `docs/guide/42-execution-lifecycle.md` (the `workflow_step` heartbeats / `run_command` note added earlier)

- [ ] **Step 1: Document the live command-output path**

Under the long-`run_command` note in `docs/guide/42-execution-lifecycle.md`, add a paragraph:

```markdown
**Live command output:** while a `run_command` step runs, the harness streams its
stdout/stderr as `command_started` / `command_output` / `command_finished` telemetry
events (`packages/core` command-events contract), attributed by `stepId`. The API
telemetry gateway broadcasts them over the run's websocket (output chunks are
published live but not persisted to the capped replay stream; `command_finished`
carries a bounded `outputTail` so late/replay viewers still see a tail and the exit
status). The web session view renders these as per-step collapsible command cards
(`StepCommandCard`). This is independent of the buffered HTTP response, which remains
the source of truth for the step verdict.
```

- [ ] **Step 2: Commit**

```bash
git add docs/guide/42-execution-lifecycle.md
git commit -m "docs: document live per-step command output streaming"
```

---

## Final verification (after all tasks)

- [ ] `npm run build --workspace=packages/core && npm run build --workspace=packages/harness-runtime`
- [ ] `npm run build:api && npm run build:web`
- [ ] `npm run test --workspace=packages/harness-runtime --run`
- [ ] `npm run test:api` (full suite green)
- [ ] `npm run test:unit:web --run`
- [ ] `npm run lint:api && npm run lint:web`
- [ ] Rebuild images (`nexus/harness-pi`, `nexus-api`) + redeploy; trigger a merge and confirm the gate's output streams into a per-step card in the session view.

```

```
