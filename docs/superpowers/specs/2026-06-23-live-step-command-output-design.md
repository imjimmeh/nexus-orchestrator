# Live Step Command Output — Design

**Status:** Approved (brainstorming) — ready for implementation plan
**Date:** 2026-06-23
**Domain:** Workflow runtime / Telemetry / Web

## 1. Problem

The session view (`/sessions/:id`) gives no visibility into a `run_command` step's
output while it runs. The merge auto-merge `quality_gate` step runs the full test
suite (`npm run build && lint && test:api && test:kanban && test:unit:web`, ~6.5–8
min) as a single buffered command: the harness runtime captures stdout/stderr and
returns them only in the final HTTP response, so nothing reaches the UI during the
run. An operator watching a long gate sees a spinner for 8 minutes, then (at best)
the whole log dumped into job state — never surfaced as terminal output.

Agent `bash` tool calls already stream; `run_command` steps are the blind spot.

## 2. Goal

Show, **live and per step**, the command being run and its terminal output as a
`run_command` step executes, presented as a per-step collapsible card in the session
view's conversation timeline.

Non-goals (YAGNI): live streaming of agent-step internal stdout beyond what already
streams; a full Gantt/timeline; surfacing command output in `docker logs`/API logs;
search/filtering within output.

## 3. Why not reuse `bash_output`

`StepContainerRuntimeService.startContainerLogStreaming()` already publishes
`bash_output` chunk events (docker logs → Redis → telemetry WebSocket → web
`TerminalPanel`). Two reasons it is the wrong source here:

1. **Mis-attribution.** The stream is opened once per container with a single
   `stepId` captured at start (`step-container-runtime.service.ts:174`); every chunk
   is tagged with that one id. A multi-step job (e.g. `implement` → `check` →
   `commit`) would attribute all output to the first step. Per-step cards need
   accurate `stepId`.
2. **Buffering.** `run_command` output never reaches docker stdout during the run
   (the harness buffers it), so `bash_output` is empty for these steps anyway.

The harness is the only component that knows exactly which step's command is
producing each chunk. It therefore emits explicitly-attributed events.

Rejected alternatives: _tee command output to docker stdout + reuse `bash_output`_
(mis-attribution for multi-step jobs; duplicates output into the merged terminal);
_SSE / streaming HTTP response_ (a new transport when the websocket telemetry path
already exists end to end).

## 4. Architecture

Three bounded units, communicating through one contract: the three command events.

```
harness-runtime (spawn + emit)  ──ws──▶  API telemetry gateway  ──Redis──▶  web
  command_started/output/finished        @SubscribeMessage handlers          StepCommandCard
                                          → processAndBroadcastEvent
```

### Event contract (`@nexus/core`)

Three new canonical events, attributed by `stepId` and ordered by `seq`:

| Event              | Payload                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `command_started`  | `{ workflowRunId, jobId, stepId, command, startedAt }`                     |
| `command_output`   | `{ workflowRunId, jobId, stepId, stream: 'stdout'\|'stderr', chunk, seq }` |
| `command_finished` | `{ workflowRunId, jobId, stepId, exitCode, timedOut, ok }`                 |

`seq` is a per-`(stepId)` monotonically increasing integer so the web can order/
de-dupe chunks regardless of websocket/Redis reordering.

### Unit 1 — Harness runtime (`packages/harness-runtime`)

- `ExecuteCommandRequest` gains optional `stepId`.
- `defaultExecuteCommand` replaces `execFileAsync('sh', ['-c', cmd])` with
  `child_process.spawn('sh', ['-c', cmd], { cwd, timeout, killSignal })`:
  - On spawn: emit `command_started`.
  - On stdout/stderr `data`: append to the response accumulator buffer **and** feed
    a batching emitter.
  - On close/exit/error: flush the batcher, emit `command_finished`, resolve the
    unchanged `{ ok, exit_code, stdout, stderr, timed_out }` response (full
    back-compat with the current API client).
- **Batching:** a small `ChunkBatcher` coalesces chunks per stream and flushes on a
  ~250 ms timer or when buffered bytes exceed a threshold (~4 KB), emitting one
  `command_output` per flush. This caps event volume from a noisy test suite while
  keeping output visibly live. The batcher is a pure, unit-tested helper.
- Emission goes through the existing `OrchestratorClient.emit(eventType, payload)`
  (already connected for `run_command` containers — logs show "Connected to
  Telemetry Gateway" for the gate). `defaultExecuteCommand` receives an emit
  callback (injected), so it stays testable without a live socket.
- Timeout semantics preserved: `spawn`'s `timeout` kills the child; `timed_out` is
  derived from the kill, `exit_code` from the close event.

### Unit 2 — API (`apps/api`)

- `executeCommandStepOnContainer` / `ContainerHttpClientService.executeCommand` pass
  `stepId: step.id` in the request.
- Telemetry gateway: add `@SubscribeMessage` handlers for `command_started`,
  `command_output`, `command_finished`, each routed through the existing
  `processAndBroadcastEvent` path (same shape as `agent_telemetry`).
- **Replay/persistence:** forward every event live to subscribers. To protect the
  10k-capped Redis replay stream from a noisy suite, persist a **bounded tail** per
  step — always persist `command_started` and `command_finished`; for
  `command_output`, retain only the last N KB per step in the replay buffer (live
  viewers see everything; a late-joiner sees the tail + final status). Exact
  mechanism chosen in the plan (e.g. a per-step ring in the persisted payload, or a
  dedicated capped key); the contract is "live = full, replay = tail + status".

### Unit 3 — Web (`apps/web`)

- A per-step command model keyed by `stepId`, built in the telemetry/chat-builder
  layer from the three events: `{ stepId, command, chunks[] (ordered by seq),
status: 'running'|'exited'|'timed_out', exitCode }`.
- A new collapsible `StepCommandCard` rendered in the conversation timeline:
  - Header: `$ <command>` + status badge (running spinner → `exit 0` / `exit N` /
    `timed out`).
  - Body: monospace, auto-scrolling output block (stdout/stderr merged in `seq`
    order, stderr visually marked). Reuse the existing terminal rendering primitive
    if it fits a card; otherwise a lightweight `<pre>` with auto-scroll.
  - Expanded while running; collapsible (and collapsed-by-default once finished, to
    keep the timeline tidy).
- The card appears on `command_started`, grows on `command_output`, finalizes on
  `command_finished`.

## 5. Data flow (happy path)

1. API dispatches `run_command` step → posts `/execute/command` with `stepId`.
2. Harness spawns `sh -c`, emits `command_started`, then batched `command_output`
   events, then `command_finished`; returns the aggregated response (unchanged).
3. Gateway handlers broadcast each event to the run's room and persist per the
   replay-tail policy.
4. Web builder folds events into the per-step model; `StepCommandCard` renders live.

## 6. Error handling

- Harness emit failures are best-effort (never block or fail the command); the
  final buffered response is the source of truth for the step verdict.
- Missing `stepId` (older API) → harness falls back to current behaviour (no
  emission) and still returns the buffered response. Back-compat both directions.
- Non-zero exit / timeout → `command_finished` carries `exitCode`/`timedOut`; the
  card shows the failure; the step verdict path is unchanged.
- Web: out-of-order/duplicate chunks reconciled by `seq`; a card with
  `command_started` but no `command_finished` (run still in flight or socket
  dropped) stays in `running` state.

## 7. Testing

- **Harness:** `defaultExecuteCommand` streams chunks (emits started/output/finished
  in order), still returns aggregated stdout/stderr, handles non-zero exit and
  timeout; `ChunkBatcher` flushes on size and timer. (vitest in
  `packages/harness-runtime`.)
- **API:** `executeCommandStepOnContainer` forwards `stepId`; gateway broadcasts the
  three new event types via `processAndBroadcastEvent`; replay-tail persistence caps
  retained output.
- **Web:** builder groups chunks by `stepId` and orders by `seq` into a card model;
  `StepCommandCard` renders command, live output, and terminal status.
- All work follows TDD (red → green → refactor).

## 8. Affected files (indicative)

- `packages/core` — new event types/payloads.
- `packages/harness-runtime/src/server/server.ts` (+ new `chunk-batcher` helper,
  request type).
- `apps/api/src/docker/container-http-client.service.ts`,
  `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.ts`,
  `apps/api/src/telemetry/telemetry.gateway.ts` (+ gateway compat helpers).
- `apps/web` — telemetry event types, chat-builder/event-map, new `StepCommandCard`,
  hook wiring.
- Docs: `docs/guide/42-execution-lifecycle.md` (or a runtime/telemetry guide),
  `docs/guide/08-workflow-runtime.md` as appropriate.

## 9. Rollout / risk

- Behind no flag by default is acceptable (additive, best-effort). If event volume
  proves problematic in practice, the batching threshold and replay-tail size are
  the tunables.
- Image rebuild required: the harness change ships in `nexus/harness-pi` /
  `nexus/harness-claude-code`; the API change ships in `nexus-api`.
