# ADR: Move Honcho Transport-Normalization Artifacts from `HonchoMemoryBackendService` to `HonchoClientService`

**Status:** Accepted
**Date:** 2026-07-03
**Work item:** 1291ad94-a07b-4fe6-91eb-456babcadb15
**Owner:** refactor-executor
**Module:** `apps/api/src/memory/`
**Related docs:** [`docs/architecture/memory-management.md`](../memory-management.md),
[`apps/api/src/memory/honcho-client.service.ts`](../../apps/api/src/memory/honcho-client.service.ts),
[`apps/api/src/memory/honcho-client.types.ts`](../../apps/api/src/memory/honcho-client.types.ts),
[`apps/api/src/memory/honcho-client.errors.ts`](../../apps/api/src/memory/honcho-client.errors.ts)

> Status line (literal): `Status: Accepted`

## Context

`HonchoMemoryBackendService` (`apps/api/src/memory/honcho-memory-backend.service.ts`,
pre-refactor ≈ 540 LOC) owns the high-level memory-read orchestration
for the Honcho backend — workspace / peer resolution,
fallback-to-Postgres decisions, and `BackendInstrumentation` counter
plumbing. The same class also carried **seven transport-layer
normalization helpers** that have no business being on a backend
service: they are pure functions of the Honcho response wire shape
and have nothing to do with backend policy.

| # | Pre-refactor helper (on `HonchoMemoryBackendService`) | LOC (pre-refactor) | Pure function? |
|---|-------------------------------------------------------|--------------------|-----------------|
| 1 | `extractCandidateMessages(response)`                  | 11                 | yes             |
| 2 | `readContent(candidate)`                              | 12                 | yes             |
| 3 | `normalizeMemoryType(value)`                          | 8                  | yes (close set) |
| 4 | `parseDate(value)`                                    | 11                 | yes             |
| 5 | `mapCandidate(candidate, ctx, index)`                 | 28                 | yes             |
| 6 | `normalizeSegments(rawJson, ctx)`                     | 16                 | yes             |
| 7 | `unknownMemoryTypePolicy()` (env resolver)            | 23                 | env-touching    |

The seven helpers collectively account for roughly **130 LOC** of
transport logic that the backend service "smuggled" into itself. The
smuggling was harmless in the original single-file world, but two
problems have since accumulated that this refactor is meant to
eliminate:

### (a) Transport-layer logic was on the wrong class

`HonchoClientService` is the only class in the module that talks
HTTP to Honcho. It owns `requestJson(...)`, the
`HONCHO_BASE_URL` / `HONCHO_RETRY_COUNT` /
`HONCHO_REQUEST_TIMEOUT_MS` plumbing, and the `path`-template
substitution for `/peers/{peerId}/...` routes. The seven normalize
helpers, by contrast, take a raw Honcho response and return
`IMemorySegment` rows — they consume the wire shape and produce a
domain value. **The helpers belong next to `requestJson`**, not
next to `shouldFallbackOnError` and `resolveWorkspaceId`. Putting
them on the backend service was a layering error.

### (b) The silent default-to-history fallback was untested

`normalizeMemoryType(value)` silently coerced every unknown
`memory_type` to `'history'` with no log line. The behaviour was
documented (the M0 implementation) but had **no test surface** — a
typo in an upstream Honcho release, or a new `MemoryType` union
member, would have been silently swallowed, and downstream consumers
would have seen "history" segments where they expected
"preference". The pre-refactor spec for
`honcho-memory-backend.service.spec.ts` does not exercise the
helper at all; it mocks `client.listPeerMemory` /
`client.searchPeerMemory` instead, which means the seven helpers
were only ever exercised end-to-end through the backend.

### (c) The helpers were not callable from outside the backend

Because the seven helpers were private methods on a NestJS
`@Injectable()` class, no test or future caller could exercise
them without instantiating the full backend — which transitively
requires `ConfigService`, `PostgresMemoryBackendService`, and
`BackendInstrumentation` mocks. The M4 spec file
(`honcho-client.service.spec.ts`, 59 it() blocks) needs to call
the helpers directly with a hand-built `HonchoRawSegment` and a
hand-built `HonchoNormalizationContext`. That is only possible
once the helpers live on the client.

### (d) The `Promise<unknown>` return types leaked the wire shape

Before the refactor, `listPeerMemory(...)` and
`searchPeerMemory(...)` returned `Promise<unknown>` — the
synthesized `IMemorySegment[]` was created inside the backend
service. That meant every consumer of those methods had to cast
the result, and the wire-shape interface (`HonchoNormalizedMessage`)
lived in the backend file rather than next to the wire. After
the refactor, both methods return `Promise<IMemorySegment[]>`
statically, and the wire-shape interface is renamed to
`HonchoRawSegment` and lives in
`apps/api/src/memory/honcho-client.types.ts` where the lint
policy requires it.

## Decision

Adopt the four-part transport-ownership shift recorded below. The
shifts are additive in M1, behaviour-preserving for any operator
who has not set the new env knob, and lay the groundwork for a
future `'throw'` opt-in (M3 or later).

### (A) Move the seven normalize artifacts to `HonchoClientService` as public static helpers

The seven helpers land on `HonchoClientService` as `public static`
methods:

| # | Old (backend private)                    | New (client public static)                  |
|---|-----------------------------------------|---------------------------------------------|
| 1 | `HonchoMemoryBackendService.extractCandidateMessages` | `HonchoClientService.extractCandidateMessages` |
| 2 | `HonchoMemoryBackendService.readContent` | `HonchoClientService.readContent`           |
| 3 | `HonchoMemoryBackendService.normalizeMemoryType`     | `HonchoClientService.normalizeMemoryType` (now takes a `policy` arg) |
| 4 | `HonchoMemoryBackendService.parseDate`  | `HonchoClientService.parseDate`             |
| 5 | `HonchoMemoryBackendService.mapCandidate`            | `HonchoClientService.mapCandidate` (now takes a `policy` arg) |
| 6 | `HonchoMemoryBackendService.normalizeSegments`       | `HonchoClientService.normalizeHonchoResponse` (renamed to reflect its orchestrator role; the call-site signature gains `unknownMemoryTypePolicy`) |
| 7 | `HonchoMemoryBackendService.unknownMemoryTypePolicy` | `HonchoClientService.unknownMemoryTypePolicy` (instance method, env-touching) |

The six pure-function helpers are `public static` so future
callers (services, controllers, tests) can invoke them without
instantiating the full NestJS provider. The instance method
`unknownMemoryTypePolicy` is a regular private method because
it needs `this.configService`. The wire-shape interface is
renamed `HonchoNormalizedMessage` → `HonchoRawSegment` to
reflect that the values flowing in are raw (not yet normalized);
the rename is documented in
`apps/api/src/memory/honcho-client.types.ts`. M2 deletes the
seven duplicates from the backend; M1 is additive (the original
inline copies remain in place unchanged).

### (B) Introduce `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY` env knob, default `'log-then-history'`

Add a closed-set env knob `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY`
to give operators a way to opt into strict or quiet modes
without code changes. The closed set:

- `'throw'` — strict mode. Unrecognized `memory_type` values
  surface as a typed
  `HonchoTransportContractError` carrying `field: 'memory_type'`.
- `'history'` — quiet mode. Same silent-to-history coercion as
  today, no log line.
- `'log-then-history'` — audit mode (default). Same
  silent-to-history coercion as today, with **exactly one**
  `Logger.warn` per process per unrecognized value. The
  one-shot flag `HonchoClientService.warnedUnknownPolicy` keeps
  the warning from flooding the log on a hot read path.

The default `'log-then-history'` is the historical behaviour
plus one log line; it is intentionally **not** `'throw'` so
existing deployments that have not configured the knob stay
on the legacy quiet path. The
`HonchoClientService.unknownMemoryTypePolicy()` resolver
treats unset / null / empty / unrecognized env values
identically — they all fall through to
`'log-then-history'`, with the warning firing once for the
unrecognized case so an operator typo is observable.

### (C) Introduce `HonchoTransportContractError` as additive infrastructure for a future `'throw'` opt-in

Add a typed error class
(`apps/api/src/memory/honcho-client.errors.ts`,
`HonchoTransportContractError extends Error`) carrying
`readonly field: string` and following the project's typed-error
convention (distinct `name`, prototype-chain restoration for
ES5-portable down-compile). The class is **not thrown by
default** — the active policy `'log-then-history'` falls through
to the legacy silent coercion. The class exists so:

- The `'throw'` policy has a real type to throw — no string
  sentinel, no second error class, no ad-hoc `Error`.
- A future opt-in (M3) can simply flip the policy in
  `normalizeMemoryType(...)` from "swallow + coerce" to
  "throw `HonchoTransportContractError`" without
  introducing a new error class in the same commit.
- Tests and exception filters can predicate on
  `err.name === 'HonchoTransportContractError'` and switch
  on `err.field` (today: `'memory_type'`; future: any new
  field that wants to opt into strict mode).

The class is documented in
`apps/api/src/memory/honcho-client.errors.ts` as additive —
no production code path throws it today; only the spec
(`honcho-client.service.spec.ts`) tests that the `'throw'`
policy surfaces it.

### (D) Extend `HonchoPeerRequest` with `entityType` + `entityId` (required)

Add `entityType: string` and `entityId: string` as required
fields on the `HonchoPeerRequest` interface (the input to
`listPeerMemory` and `searchPeerMemory`). Both fields are
required because the synthesizer seeds two `IMemorySegment`
fields from them verbatim (`entity_type`, `entity_id`) and
synthesizes the fallback id
`` `${entityType}:${entityId}:${index}` `` when the raw
candidate has no upstream `id`. Both backend call sites
(`getMemorySegments` and `searchMemory` in
`HonchoMemoryBackendService`) already have the values in
scope, so this is a required-on-the-contract boundary
rather than a default. The two backend call sites are
updated to pass `entityType` / `entityId` through.

The `Promise<IMemorySegment[]>` return-type tightening on
`listPeerMemory` / `searchPeerMemory` is the natural
consequence of moving the synthesizer to the client — once
the helpers live on `HonchoClientService`, the methods
narrow from `Promise<unknown>` to `Promise<IMemorySegment[]>`
with no extra cast layer.

## Alternatives

### (i) Throw by default on unknown `memory_type` — REJECTED

Flip the default policy from `'log-then-history'` to `'throw'`
in the same milestone that introduces the typed error class.

Rejected because existing deployments have not configured
the new env knob yet — a single unrecognized `memory_type`
value in any historical Honcho response would surface as a
crash instead of a log line, and the recovery is
operator-driven (set the env knob, redeploy). The new
typed error class plus the opt-in env knob give operators
the same loud-failure behaviour **on demand** without
forcing it on every production deployment. Future
deployments that want strict mode can flip
`HONCHO_UNKNOWN_MEMORY_TYPE_POLICY=throw` independently.

### (ii) Separate pure-helper sibling module that wraps the call — REJECTED

Introduce a new
`apps/api/src/memory/honcho-client.normalize.helpers.ts`
(or `honcho-segment-synthesizer.helpers.ts`) that holds
the six pure functions as exports, and have
`HonchoClientService` re-export them as instance methods
that delegate to the module. The wire-shape interface
(`HonchoRawSegment`) and the error class
(`HonchoTransportContractError`) would land in the new
module's barrel.

Rejected because the new module would be a thin
indirection layer that adds a path to every call site
without adding typing or testability. The static-method-
on-class approach keeps the helpers next to `requestJson`
in the same file, statically importable, and immediately
testable without DI. The project's lint policy
(`apps/api/eslint.config.mjs`) requires exported
interfaces and type aliases in `*.types.ts` files, but
the helpers themselves are methods, not types — they
do not need their own file. The new
`honcho-client.types.ts` (created in M1) and
`honcho-client.errors.ts` (created in M1) split out the
**types** and the **error class** because the lint
policy asks for them; the methods stay on the service.

### (iii) Keep the seven helpers on the backend but expose them as a static surface — REJECTED

Move the helpers to `public static` methods on
`HonchoMemoryBackendService` instead of on
`HonchoClientService`. The class boundary would stay in
place; only the visibility would change.

Rejected because the layering problem (the helpers are
about the wire, not the backend) would not be fixed —
the helpers would still be physically on the backend
service file, and the wire-shape interface
(`HonchoRawSegment`) would still have to live there
because the helpers consume it. The M4 spec file wants
to call `HonchoClientService.normalizeHonchoResponse`
directly without instantiating the backend; keeping the
helpers on the backend would force the spec to spin up
the full backend module to test wire-shape behaviour,
which defeats the point of the move.

## Consequences

### Risk profile for existing deployments

- **Default behaviour preserved.** Operators who have not
  set `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY` keep getting
  the historical silent-to-history coercion, with the
  addition of a single `Logger.warn` per process per
  unrecognized value. Reads do not break, the response
  shape does not change, and the synthesized
  `IMemorySegment` rows are byte-for-byte identical to
  pre-refactor for every well-known `memory_type` value.
- **Future opt-in is one env-knob flip.** Strict mode is
  `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY=throw`; quiet mode
  is `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY=history`; audit
  mode is `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY=log-then-history`
  (or unset). No code change, no redeploy beyond the
  env-var change.
- **Typed error class is in place for that future throw.**
  `HonchoTransportContractError` is additive — it does
  not affect any current call site. M3 can wire
  exception filters, alerting, or `instanceof` checks
  without introducing a new error class in the same
  commit.

### Code-shape impact (after M1–M4)

- `apps/api/src/memory/honcho-memory-backend.service.ts`
  shrinks by **roughly 130 LOC** (the seven duplicates
  are deleted in M2; the new `entityType` / `entityId`
  calls add three lines, the rest is pure deletion).
- `apps/api/src/memory/honcho-client.service.ts` grows
  by **roughly 130 LOC** (the seven public statics
  plus their JSDoc) and the existing instance methods
  (`listPeerMemory`, `searchPeerMemory`) are rewritten
  to thread the env-resolved policy into the static
  helpers.
- `apps/api/src/memory/honcho-client.types.ts` and
  `apps/api/src/memory/honcho-client.errors.ts` are
  new files: ~85 LOC of types and ~50 LOC of error
  class, respectively. Both are pure value files
  (no runtime code, no DI, no NestJS decorator).
- `apps/api/src/memory/honcho-client.service.spec.ts`
  is a new spec file with **59 it() blocks** (Task
  4.1 unit tests for the six statics plus Task 4.2
  integration tests for the four well-known envelope
  shapes `results` / `messages` / `items` / `data`).
  The spec exercises the helpers directly with no
  NestJS DI and no fetch mock for the static tests,
  and through a real `Test.createTestingModule(...)`
  with `vi.spyOn(globalThis, 'fetch')` for the
  integration tests.

### Type-tightening impact

- `HonchoClientService.listPeerMemory` and
  `HonchoClientService.searchPeerMemory` return
  `Promise<IMemorySegment[]>` (was `Promise<unknown>`).
  Both backend call sites
  (`getMemorySegments` and `searchMemory` in
  `HonchoMemoryBackendService`) are updated to remove
  the cast on the return value.
- `HonchoPeerRequest` gains `entityType` and
  `entityId` as required fields. The single in-tree
  test (the new `honcho-client.service.spec.ts`)
  and the two backend call sites pass both fields
  in all invocations.

### Test-surface impact

- The pre-refactor spec
  (`honcho-memory-backend.service.spec.ts`) loses
  nothing — the backend's public surface is
  unchanged. The mocks for
  `HonchoClientService.listPeerMemory` /
  `searchPeerMemory` are updated to match the
  new `HonchoPeerRequest` shape (gains
  `entityType` / `entityId`); the return-type
  tightening is a strict upgrade.
- The new spec
  (`honcho-client.service.spec.ts`) is
  **59 it() blocks** covering:
  - `normalizeMemoryType` round-trips for the four
    closed-set members (4) + silent fall-through on
    unknown values for the two quiet policies (2)
    + `throw` surfaces a
    `HonchoTransportContractError` (1).
  - `readContent` alias priority
    (`content` / `text` / `message` / `body`) and
    empty-string handling (5).
  - `parseDate` for `Date` instance, valid ISO
    string, invalid string, `null` (4).
  - `extractCandidateMessages` for top-level
    array, each of the four envelope keys
    (`results` / `messages` / `items` / `data`),
    non-object input, missing keys (7).
  - `mapCandidate` happy path, missing content
    filter, id fallback shape
    (`` `${entityType}:${entityId}:${index}` ``),
    version fallback to 1 (4).
  - `normalizeHonchoResponse` end-to-end with
    each of the four envelope keys (4).
  - Integration: real `HonchoClientService` through
    `Test.createTestingModule(...)` with
    `vi.spyOn(globalThis, 'fetch')`, asserting
    `Promise<IMemorySegment[]>` for the four
    envelope shapes (4).
  - Plus the `unknownMemoryTypePolicy` env-knob
    resolver for unset / `'throw'` / `'history'` /
    `'log-then-history'` / unrecognized value with
    one-shot warn (5).
  - Plus the JSDoc-pinned spec entries listed in
    the `honcho-client.service.spec.ts` file
    header (the exact count of 59 is locked in
    the spec's `it(...)` list).

  All 59 it() blocks pass under
  `npm run test --workspace=apps/api`.

### Operational note

The new `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY` env knob is
documented in
`docs/architecture/memory-management.md` (see the
**Transport Ownership** subsection added in M5). Operators
who want strict mode set the env var to `'throw'`; the
typed error surfaces at the boundary so the regression
is visible in the call stack and alertable.

## Status

Status: Accepted. Owner: refactor-executor.

This ADR records the M5 milestone of work item
`1291ad94-a07b-4fe6-91eb-456babcadb15`. M1–M4 are
already landed (the seven statics, the env knob, the
typed error class, the `entityType` / `entityId`
extension, the slimmed backend, the 59-it() spec
file). M5 captures the architectural decision in this
ADR and adds a brief pointer to
`docs/architecture/memory-management.md` so operators
discovering the new env knob have a single place to
land.

## References

- `apps/api/src/memory/honcho-client.service.ts` —
  the receiving class for the seven public statics.
  `extractCandidateMessages` (line 175),
  `readContent` (line 205), `normalizeMemoryType`
  (line 240), `parseDate` (line 280),
  `mapCandidate` (line 305), `normalizeHonchoResponse`
  (line 360), `unknownMemoryTypePolicy` (line 405).
- `apps/api/src/memory/honcho-client.types.ts` —
  `HonchoRawSegment` (line 32),
  `HonchoNormalizationContext` (line 60),
  `UnknownMemoryTypePolicy` (line 95).
- `apps/api/src/memory/honcho-client.errors.ts` —
  `HonchoTransportContractError` class.
- `apps/api/src/memory/honcho-memory-backend.service.ts` —
  the slimmed backend service (M2-deleted inline
  copies). `getMemorySegments` (line 65),
  `searchMemory` (line 165).
- `apps/api/src/memory/honcho-client.service.spec.ts` —
  the new spec file, 59 it() blocks.
- `apps/api/src/memory/honcho-memory-backend.service.spec.ts` —
  the updated mocks (gains `entityType` / `entityId`
  on every `listPeerMemory` / `searchPeerMemory` call).
- `docs/architecture/memory-management.md` —
  updated with a **Transport Ownership** subsection
  pointing back to this ADR.
- The pre-refactor git history of
  `apps/api/src/memory/honcho-memory-backend.service.ts`
  captures the seven private helpers as they were
  before M2 deleted them; the M1 staging preserves
  both copies in the diff so the relocation is
  reviewable in one place.
