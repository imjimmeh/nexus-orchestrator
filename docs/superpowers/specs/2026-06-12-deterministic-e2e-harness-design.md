# Deterministic E2E Harness — Design

- **Date:** 2026-06-12
- **Status:** Approved (design); pending implementation plan
- **Scope:** Replace the stale, real-LLM e2e suite with a hermetic, deterministic black-box suite that exercises **real API + real Kanban + real runner containers + both harness engines (PI/OpenAI, Claude Code/Anthropic)**, with the LLM as the only fake component.

## 1. Problem & Goals

The existing e2e suite (`packages/e2e-tests`) is out of date and unused. Most of it drives the live stack against **real LLMs** (kanban lifecycle phases 1–6, review workflow, workflow-execution scenarios), making it non-deterministic, slow (30–40 min), and flaky. The deterministic pieces that exist are partial: `apps/api/test/helpers/fake-llm-server.ts` is a single-shot OpenAI-only mock, and `tool-array-serialization-harness.ts` boots a real runner container with a bespoke fake LLM but **bypasses the API and Kanban services**, testing the runner in isolation.

### Goals

- A deterministic, repeatable suite testing **API + Kanban + runners** together, black-box.
- A reusable **fake LLM server** that:
  - Conditionally returns responses based on request input (matcher rules).
  - Lets tests **validate the input the model received** (prompts, system, tools).
  - Speaks **both** wire protocols: OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`), JSON and SSE streaming.
- Docker lifecycle owned **in code** (testcontainers), exposed via a single `npm run test:e2e` and a CI job.

### Non-goals

- Web (browser) e2e — explicitly out of scope for this effort.
- Recording/replay of real LLM traffic (rejected; see §4).
- Load/stress/concurrency testing.

## 2. Key Facts That Shape The Design

- **Two engines, two protocols.** PI harness → OpenAI-compatible, `OPENAI_BASE_URL`. Claude Code harness → Anthropic, `ANTHROPIC_BASE_URL` via `@anthropic-ai/sdk`.
- **LLM endpoint injection path:** DB `llm_providers.runtime_env` (base URL) → `AiConfigurationService.resolveRunnerProviderConfig()` → `HarnessRuntimeConfig` stored in Redis (`runner-config:{runId}:{stepId}`) → runner container pops config → engine calls the LLM at `model.baseUrl`.
  - Key files: `apps/api/src/database/seeds/agent/llm-providers.seed.ts`, `apps/api/src/ai-config/ai-configuration.service.ts`, `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts`, `apps/api/src/redis/runner-config-store.service.ts`.
- **Runner containers are spawned by the API at runtime** via dockerode — not by the harness. They reach the host via `host.docker.internal` (already used for `WEBSOCKET_URL`). See `apps/api/src/workflow/workflow-step-execution/step-agent-container-config.helpers.ts`.
- **Kanban makes no LLM calls.** Only API-spawned runner containers do. Kanban participates via API/MCP callbacks.

## 3. Architecture & Topology

Hermetic stack orchestrated in code via **testcontainers**; the fake LLM runs **in-process in the Vitest runner**.

```
                       Vitest runner (host process)
   ┌─────────────────────────────────────────────────────────────┐
   │  Test spec ── loads Scenario ──▶ Fake LLM (in-process HTTP)   │
   │      │                              ▲  records requests       │
   │      │ drives via HTTP/WS           │  (asserted directly)    │
   ▼      ▼                              │ host.docker.internal:P  │
   └──────┼──────────────────────────────┼─────────────────────────┘
          │                              │
   ┌──────▼───────── named docker network ──────────────────────┐
   │  Postgres   Redis   API  ◀──callbacks──  Runner container   │
   │                      │                   (nexus-light/heavy) │
   │                    Kanban ◀──callbacks──        │            │
   │                      ▲   spawns at runtime ──────┘            │
   └──────────────────────────────────────────────────────────────┘
```

### Decisions

- **Fake LLM in-process (not a container).** Tests get synchronous control over scenarios and direct in-memory access to the recorded-request log — no control-API round-trip or log scraping.
- **Reachability seam:** seed provider `base_url = http://host.docker.internal:<fakePort>/v1`. Runner containers reach the host gateway the same way they already reach `WEBSOCKET_URL`. This avoids coupling to testcontainers' random network names. On Linux CI, runner containers need `--add-host=host.docker.internal:host-gateway` (verified in the networking spike).
- **Single named network** created by the harness; API + Kanban join it, and the API is configured (via env it already reads, e.g. `API_BASE_URL`, network name) to attach runtime-spawned runner containers to the **same** network so runner→API/Kanban callbacks resolve.
- **Two seeded providers** (OpenAI-shaped + Anthropic-shaped), both pointing at the fake LLM. Per-scenario engine choice via agent profile / workflow step override.

### Data flow per step

Test loads scenario → drives API over HTTP/WS → API resolves provider → Redis → spawns runner container → container calls fake LLM via `host.docker.internal` → scripted turns drive tool calls / completion → runner posts callbacks to API/Kanban → test asserts on Kanban state + workflow events + recorded LLM requests.

### Headline technical risk

Runtime-spawned-runner ↔ testcontainers networking (shared network name + `host.docker.internal` host-gateway resolution). **Mitigation:** a networking spike is the first build step, before any scenario work.

## 4. The Fake LLM Server

One in-process module exposing two protocols on one port, plus a programmatic control/assertion surface the test holds by reference.

### Endpoints

- **OpenAI:** `POST /v1/chat/completions` (JSON + SSE), `GET /v1/models`.
- **Anthropic:** `POST /v1/messages` (JSON + SSE), plus any minimal auxiliary routes the `@anthropic-ai/sdk` probes.
- Per-protocol request→canonical adapter and response serializer; **shared** matcher engine and recorded-request log.

### Scenario model (matcher rules)

```ts
Scenario = { name: string; rules: Rule[] }

Rule = {
  match: {                 // all provided predicates AND together; omitted = ignored
    model?: string | RegExp
    systemIncludes?: string
    userIncludes?: string        // last user message
    hasTool?: string             // tool present in the request's tool list
    toolResultFor?: string       // responding to a prior tool's result
    callIndex?: number           // Nth matching call
  }
  respond: TextTurn | ToolCallTurn | ToolCallTurn[]   // protocol-agnostic
}
```

- **First matching rule wins.**
- `respond` is authored once in a neutral shape and rendered into whichever protocol made the request (OpenAI `tool_calls` vs. Anthropic `tool_use`; streaming and non-streaming).
- **Unmatched requests fail loud:** recorded and answered with an error sentinel that surfaces as a test failure (no silent default response).

### Authoring format

**TypeScript builders**, co-located with specs (type-safe matchers, refactor-friendly), e.g.:

```ts
scenario("qa-approve")
  .whenTool("submit_qa_decision")
  .reply(toolCall("submit_qa_decision", { decision: "approve" }))
  .otherwise(text("Done."));
```

### Recording & assertions (direct, in-memory)

- Every request captured canonically: `{ protocol, model, system, messages, tools, toolChoice, rawBody, headers }`.
- Tests assert directly against the server object:
  - `server.requests.lastFor('claude-code')`
  - `expect(req.tools.map(t => t.name)).toContain('submit_qa_decision')`
  - `expect(req.system).toContain(...)`
- `server.reset()` between tests; `server.loadScenario(...)` swaps active rules.

### Replaces (eliminate, don't deprecate)

- `apps/api/test/helpers/fake-llm-server.ts` (single-shot, OpenAI-only) — deleted.
- The bespoke fake server embedded in `tool-array-serialization-harness.ts` — deleted; caller repointed at the new module.

## 5. Components & Module Layout

`packages/e2e-tests/src` (after clearing the stale suite):

```
fake-llm/
  server.ts              # dual-protocol HTTP server + matcher engine + recorder
  protocols/openai.ts     # request adapter + response/SSE serializer
  protocols/anthropic.ts  # request adapter + response/SSE serializer
  scenario.ts            # TS scenario builder + Rule/Turn types
  recorder.ts            # canonical request log + assertion helpers
stack/
  stack-harness.ts       # testcontainers lifecycle (pg, redis, api, kanban, network)
  seed.ts                # seed the two providers (OpenAI+Anthropic) → fake LLM base_url
  docker-network.ts      # named network + host-gateway wiring
driver/
  api-client.ts          # HTTP client (port existing infra/api-client)
  ws-observer.ts         # workflow run / event WS observer (port run-workflow-observer)
  polling.ts             # deterministic poll-until helpers (port infra/polling)
  auth.ts                # admin/agent JWT minting (port infra/auth)
scenarios/               # the *.e2e-spec.ts suites, built in priority order
```

### `StackHarness` lifecycle (global setup, in code)

1. Create named network → start Postgres + Redis → run migrations + seed.
2. Start fake LLM in-process; seed both `llm_providers` rows to `http://host.docker.internal:<port>/v1`.
3. Start API + Kanban containers on the network, env-configured to (a) attach runner containers to the same network and (b) resolve `host.docker.internal`.
4. Wait-for-ready (health endpoints) → hand running context to specs.
5. Teardown: stop containers, network, fake LLM; surface container logs on failure.

### Assertion surfaces (all deterministic)

- **Kanban state** — work-item statuses, board distribution, dispatch order (Kanban API).
- **Workflow run + event ledger** — run status, step outcomes, tool-call events (API).
- **Fake-LLM recorded requests** — exact prompts/system/tools the engine sent.

## 6. Build & Priority Sequence

Each step is a vertical slice proving more of the harness:

1. **Networking spike** — one trivial workflow that spawns a runner container, calls the fake LLM, posts one callback. Proves the whole seam before investing in scenarios.
2. **Generic workflow execution** — single-step + multi-step DAG, both OpenAI and Anthropic engines, tool-call turns.
3. **Review / QA callback** — `submit_qa_decision` approve vs. reject paths.
4. **Kanban lifecycle** — create → in-progress → in-review → ready-to-merge → done.
5. **Repair / failure paths** — scripted step failure → classification → repair dispatch.

## 7. Invocation & Gating

- `npm run test:e2e` → `StackHarness` setup + all scenarios + teardown.
- Skipped in normal unit runs via an env gate.
- Wired as its own CI job (Docker-enabled runner).
- Existing `test:e2e:*` scripts repointed/removed to match the new single entry point.

## 8. Risks & Mitigations

| Risk                                               | Mitigation                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Runtime-spawned runner ↔ testcontainers networking | Networking spike is step 1; shared named network + `host.docker.internal:host-gateway`.                     |
| Anthropic SSE/tool framing divergence from OpenAI  | Per-protocol serializers with shared turn model; conformance-test each serializer against its SDK's parser. |
| Image freshness (`nexus-light`/`nexus-heavy`)      | Harness asserts required images exist (or builds) during setup; fail loud if missing.                       |
| Flaky waits                                        | Deterministic poll-until on health/state, no fixed sleeps; bounded timeouts with log dump on failure.       |
| Scenario gaps                                      | Unmatched LLM requests fail loud, recorded for diagnosis.                                                   |

## 9. Out-of-Scope Cleanup (this effort)

- Delete stale `packages/e2e-tests` suites and legacy `.mjs` runners; keep the genuinely-deterministic `imported-repo-mixed-reality` test.
- Delete `apps/api/test/helpers/fake-llm-server.ts` and the embedded fake server in the tool-array harness; repoint callers.
