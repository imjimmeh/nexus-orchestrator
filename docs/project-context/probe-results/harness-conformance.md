---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: harness-conformance
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - packages/harness-conformance/package.json
  - packages/harness-conformance/vitest.config.ts
  - packages/harness-conformance/tsconfig.json
  - packages/harness-conformance/test/conformance/conformance-suite.ts
  - packages/harness-conformance/test/conformance/pi.conformance.test.ts
  - packages/harness-conformance/test/conformance/claude-code.conformance.test.ts
  - packages/harness-conformance/test/conformance/claude-code-session-jsonl.test.ts
  - packages/harness-conformance/test/conformance/fixtures/pi.ts
  - packages/harness-conformance/test/conformance/fixtures/pi.types.ts
  - packages/harness-conformance/test/conformance/fixtures/claude-code.ts
  - packages/harness-conformance/test/conformance/fixtures/claude-code.types.ts
  - packages/harness-conformance/test/conformance/__mocks__/claude-agent-sdk.ts
  - packages/harness-conformance/test/conformance/__fixtures__/claude-v3-golden.jsonl
  - docs/superpowers/specs/2026-06-15-claude-code-session-persistence-design.md
  - docs/superpowers/plans/2026-06-15-claude-code-session-persistence.md
source_paths:
  - packages/harness-conformance/
updated_at: 2026-06-15T17:30:00.000Z
---

# Probe Result: Harness Conformance Tests

## Narrative Summary

`packages/harness-conformance/` is a fully implemented, hermetic Vitest suite that
defines the cross-engine contract for the harness runtime kernel. It exercises both
`@nexus/harness-engine-pi` and `@nexus/harness-engine-claude-code` against the same
9-case matrix (C1–C9) plus a golden v3 JSONL conformance check for the new
`V3SessionWriter` + `ClaudeV3Mapper` persistence path. The package is small (~1,176
LoC across 12 files) but structurally mature: it has its own `vitest.config.ts` that
aliases all four workspace packages to their TypeScript sources (no `dist` build
required), a `@anthropic-ai/claude-agent-sdk` redirect to a local stub, a shared
`conformance-suite.ts` with mock-context/config factories, two scripted-fixture
modules that produce canonical-shaped events on demand, and a vitest `__mocks__`
sibling that exposes `setQueryImpl` / `getLastQueryOptions` for per-test control of
the Claude Code `query()` generator. The package was introduced with EPIC-196
(Phase 2 pluggable harness runtime, commit `6cc2d29a0`) and the JSONL golden
fixture was added later (commit `f8c4dbba6`) as part of the claude-code session
persistence feature.

## Capability Updates

- **Cross-engine conformance matrix (C1–C9).** Both `pi.conformance.test.ts` and
  `claude-code.conformance.test.ts` run the same 9 cases in lock-step:
  - C1 — `validate()` returns `{ ok: true }` for a well-formed
    `HarnessRuntimeConfig`.
  - C2 — `createSession()` returns a `HarnessSession` exposing `subscribe`,
    `prompt`, `abort`, `dispose`.
  - C3 — Session emits a `turn_start` event.
  - C4 — `tool_execution_start` carries `toolCallId`, `toolName`, `args`.
  - C5 — `tool_execution_end` carries `toolCallId`, `isError`.
  - C6 — `agent_end` carries `output.ok`, `output.response`, `output.stopReason`.
  - C7 — Governance deny blocks tool execution (PI invokes `checkPermission`
    directly on the wrapped `CanonicalToolDefinition`; CC verifies no
    `tool_execution_start` is produced by the deny generator).
  - C8 — `api_key` auth reaches the right sink (PI calls
    `AuthStorage.setRuntimeApiKey("anthropic", key)`; CC injects
    `ANTHROPIC_API_KEY` into `query().options.env`).
  - C9 — `oauth` auth reaches the right sink (PI seeds
    `AuthStorage.inMemory({ anthropic: { type: "oauth", ... } })`; CC injects
    `CLAUDE_CODE_OAUTH_TOKEN=access-abc`).
  Duplication between the two files is documented and intentional — Vitest's
  `vi.mock` hoisting prevents the cases from being driven from a shared runner
  because the PI and CC engines need different module-level mocks.
- **Hermetic test execution.** `vitest.config.ts` aliases
  `@nexus/core`, `@nexus/harness-runtime`, `@nexus/harness-engine-pi`,
  `@nexus/harness-engine-claude-code` to each package's `src/index.ts` and
  redirects `@anthropic-ai/claude-agent-sdk` to
  `test/conformance/__mocks__/claude-agent-sdk.ts`. The result is that the
  `ClaudeCodeEngine`'s dynamic `import("@anthropic-ai/claude-agent-sdk")`
  resolves to the stub regardless of node_modules hoisting and the suite never
  needs a pre-built `dist/`. `node:fs` is partially mocked inside
  `pi.conformance.test.ts` so `SessionManager.create` always proceeds.
- **Scripted SDK fakes.** `fixtures/pi.ts` exposes a `FakePiAgentSession` whose
  `subscribe()` schedules `setTimeout(emit, 0)` so the
  `PiHarnessSession` constructor returns before events flow; `makeScriptedPiEvents()`
  produces a deterministic `turn_start → tool_execution_start → tool_execution_end → agent_end`
  sequence. `fixtures/claude-code.ts` exposes three async generators —
  `makeFullSessionGenerator` (tool call happy-path), `makeDenySessionGenerator`
  (no `tool_use` is yielded), `makeMinimalSessionGenerator` (single
  `result` for auth tests) — selected per test via
  `setQueryImpl` from the SDK mock.
- **Auth delivery contract.** `conformance-suite.ts` provides
  `API_KEY_AUTH_FIXTURE` and `OAUTH_AUTH_FIXTURE` plus
  `makePiConfigWithAuth` / `makeClaudeCodeConfigWithAuth` so the C8/C9 cases
  are isolated from config-construction noise. The PI assertion pins the exact
  key on `lastAuthStorageStub!.setRuntimeApiKey`; the CC assertion reads
  `getLastQueryOptions().env.ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`.
- **Golden v3 JSONL conformance.** `claude-code-session-jsonl.test.ts` drives
  a fixed Anthropic SDK stream (assistant text + tool_use + user tool_result +
  result) through `ClaudeV3Mapper` and a deterministic `V3SessionWriter`
  (`genId: () => "node{n}"`, `now: () => "2026-06-15T00:00:00.000Z"`), then
  diffs the produced lines against
  `__fixtures__/claude-v3-golden.jsonl` after normalizing `id`, `parentId`,
  and `timestamp` to placeholders. It also enforces the two structural
  invariants `node.id` and `node.type` truthy plus a valid
  `parentId → existing-id` DAG, which is the same invariant set
  `apps/api/src/session/jsonl-validation.service.ts` checks at ingest time.
  This is the format-identical guarantee called out in
  `docs/superpowers/specs/2026-06-15-claude-code-session-persistence-design.md`
  (Testing → "Golden conformance").
- **Shared helpers.** `conformance-suite.ts` exports `makeMockContext`
  (overridable `HarnessSessionContext` factory using
  `vi.fn(() => Promise.resolve({ status: "allowed" }))` for
  `checkPermission`) and `collectEvents(session, timeoutMs=2000)` which
  subscribes and resolves on `agent_end` or `agent_error` or timeout —
  used by both engine suites so the timeout/cleanup behaviour is
  identical.

## Health Findings

- **Test count.** 19 conformance cases total: 9 in
  `pi.conformance.test.ts`, 9 in `claude-code.conformance.test.ts`, 1 golden
  JSONL test in `claude-code-session-jsonl.test.ts`. The C1–C9 matrix matches
  one-for-one between the two engines, so a regression in either is
  immediately visible by side-by-side comparison.
- **Hermeticity.** The vitest config explicitly resolves all four
  workspace packages to source, avoiding `dist` build-order dependency
  bugs that have historically broken the workspace (`9d5c40793`,
  `430f8dcf8`). The CC SDK alias is required because the engine uses
  `await import("@anthropic-ai/claude-agent-sdk")` dynamically — without
  the alias, vitest's mock-hoisting would not intercept the dynamic
  import.
- **Type safety.** `tsconfig.json` is strict (`strict: true`, `target: ES2022`,
  `module: NodeNext`, `noEmit: true`). Fixture types live in
  `fixtures/pi.types.ts` and `fixtures/claude-code.types.ts` and mirror
  the engine-internal `RawEvent` / `SdkMessage` shapes the engines consume.
- **Churn.** `git log -- packages/harness-conformance/` shows the package
  was introduced with the EPIC-196 merge (`6cc2d29a0`) and has seen four
  follow-ups (formatting, two lint cleanups, the JSONL golden fixture).
  No deletions, no test removal — only additive growth.
- **Lint.** The package participates in the workspace ESLint config
  (`eslint --config ../../eslint.config.mjs --fix` per `package.json`),
  and the most recent `9d5c40793` commit explicitly resolves pre-existing
  lint errors. There are no outstanding lint-blocking issues in scope.
- **Coverage gaps.** C7 is tested differently for the two engines on
  purpose: PI's governance wraps tools at the `CanonicalToolDefinition`
  layer and the test invokes `governedTool.execute` directly because the
  scripted `FakePiAgentSession` bypasses the execute path; CC's governance
  runs inside the SDK's `canUseTool` callback and is verified by feeding
  in a deny generator. Both approaches are documented in the test file
  headers. No missing C-cases were identified.

## Open Questions

- **Real-API integration.** The conformance suite uses scripted fakes for
  both the Pi SDK (`@earendil-works/pi-coding-agent`) and the Anthropic SDK
  (`@anthropic-ai/claude-agent-sdk`). It validates the engine contract and
  the v3 JSONL format, but it does not exercise a real network round-trip
  to Anthropic. CI coverage of the live SDK is presumably handled by
  `packages/e2e-tests/` (out of probe scope) — not validated here.
- **C1 validate negative cases.** Both engine files only assert the
  positive `validate() → { ok: true }` path. Negative-path validation
  (malformed config, missing auth, unknown harnessId) is presumably
  covered in `harness-engine-pi/src/pi-engine.suspend.spec.ts` and
  the CC engine spec files, but cross-engine symmetry for those cases
  is not enforced by this conformance suite.
- **Golden fixture scope.** `claude-v3-golden.jsonl` only pins the
  `model_change` + `assistant(text+tool_use)` + `toolResult` happy path.
  A streaming-delta scenario, an `error` result subtype, or a thinking
  block are not yet pinned — any future change in those paths would not
  be caught by the golden test, only by the structural invariant
  checks.
- **Vitest hoisting workaround durability.** The header comment in
  `conformance-suite.ts` notes that C1–C7 are duplicated per engine
  because `vi.mock` cannot be encapsulated in a shared function. If
  Vitest ever changes mock-hoisting semantics, the duplication needs
  re-evaluation; currently this is a known design constraint, not a
  defect.
