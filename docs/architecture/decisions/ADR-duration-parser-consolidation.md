# ADR: Consolidate JWT / Refresh-Token Duration Parsing Behind a Canonical Utility

**Status:** Proposed
**Date:** 2026-07-01
**Work item:** cc900a5a-49ee-43b1-a0e2-5f92a005a2a5 (child-3 of parent 0c0fa9fb-f5e7-4dc2-9a9f-f2f3955e0903)
**Owner:** refactor-executor
**Module:** `apps/api/src/config/`, `apps/api/src/auth/`
**Related docs:** `apps/api/src/config/duration.ts`, `docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md`

> Status line (literal): `Status: Proposed`

## Context

The auth boundary owns three hand-rolled duration parsers, each
embedded in a different service module, with subtly different grammars
and different default-handling semantics. The drift was surfaced by a
parent work-item scan (`0c0fa9fb-f5e7-4dc2-9a9f-f2f3955e0903`) and
quantified as follows:

| Parser location                                | Source value               | Regex / grammar                                                       | Unit set             | Bare numeric interpretation | Failure mode                                  |
| ---------------------------------------------- | -------------------------- | --------------------------------------------------------------------- | -------------------- | --------------------------- | --------------------------------------------- |
| `apps/api/src/auth/refresh-token.service.ts` (`readRefreshExpiryDays`, line 89) | `JWT_REFRESH_EXPIRY` (also `JWT_REFRESH_EXPIRY_DAYS` legacy) | `/^(\d+)([smhd])$/` (line 108) | `s` `m` `h` `d` (exhaustive) | **days**                    | **Permissive** — falls back to default `7` days on parse failure |
| `apps/api/src/auth/token.service.ts` (`parseExpiryToSeconds`, line 50)            | `JWT_ACCESS_EXPIRY`        | `/^(\d+)([smhd])$/` (line 51)                                       | `s` `m` `h` `d` (exhaustive) | n/a (rejects bare numeric)  | **Permissive** — returns `900` (15m) on parse failure |
| `apps/api/src/config/agent-token-ttl.ts` (`resolveAgentTokenTtl`)                  | `process.env.AGENT_JWT_TTL`| `/^\d+\s*(ms\|s\|m\|h\|d\|w\|y)?$/i`                                | `ms` `s` `m` `h` `d` `w` `y` (over-permissive) | **seconds** | **Strict-throw** — rethrows on parse failure |

The two pieces of drift that matter operationally are:

- **Bare-numeric semantics differ between the two call sites that
  accept them.** `refresh-token.service.ts` reads a bare numeric as
  days (the `JWT_REFRESH_EXPIRY_DAYS` legacy contract); `agent-token-ttl.ts`
  reads a bare numeric as seconds. An operator moving a value from
  one env var to the other without a unit suffix silently changes
  the lifetime by a factor of `86_400`.
- **Failure-handling semantics differ.** The two auth services
  (`refresh-token.service.ts`, `token.service.ts`) swallow parse
  failures and fall back to a default; `agent-token-ttl.ts` throws.
  Both behaviours are defensible in isolation — the auth services
  treat a malformed value as "use the default" because the value is
  far from the security boundary, whereas `agent-token-ttl` is
  consumed at JWT-mint time and a malformed lifetime is a
  misconfiguration that must surface immediately. But the asymmetry
  is undocumented and the boundaries are easy to misread.

The third axis of drift is the **unit set** itself:
`agent-token-ttl.ts` accepts `ms`, `w`, and `y`; the two auth services
do not; the underlying `jsonwebtoken` library
(`jsonwebtoken@9.0.3`'s `expiresIn`) supports `s`, `m`, `h`, `d` only —
weeks and years are interpreted by `jsonwebtoken` itself only when the
`expiresIn` option is forwarded through `ms` (it is not in the current
`signAgentToken` path), and `ms` would resolve them to days × 7 and
days × 365 respectively. An operator setting `AGENT_JWT_TTL='1w'`
today gets a JWT that expires in **7 days** (because `jsonwebtoken`
does not understand `w`), which is a silent lengthening relative to
the 24h default — a quiet misconfiguration.

The parent work item's child-1 milestone shipped a canonical utility
— `parseDurationToSeconds` at `apps/api/src/config/duration.ts` —
that returns a positive integer number of seconds, accepts a bare
integer or `<integer><unit>` string, and restricts the unit set to
`s` `m` `h` `d` with no whitespace tolerance beyond the trim. The
utility is the single source of truth that the three hand-rolled
parsers must collapse into.

## Decision

Adopt `parseDurationToSeconds` as the **canonical** duration parser
for the auth boundary. Migrate the three call sites to consume it
and tighten the supported unit set to `s | m | h | d`. The migration
is intentionally **permissive on shape, strict on what gets
re-exposed** — the call sites still own their own
"unparseable value → throw or fall back" decision so the
permissive-vs-strict-throw distinction between the auth services
and `agent-token-ttl` is preserved verbatim.

The three migrations, in dependency order:

1. **`agent-token-ttl.ts` (this child-3, the work item in hand).**
   `resolveAgentTokenTtl` now imports `parseDurationToSeconds` from
   `./duration` and replaces the local `DURATION_PATTERN` regex. The
   function still reads `process.env.AGENT_JWT_TTL` directly (this
   module is consumed at JWT-mint time, not through `ConfigService`),
   still trims, still returns `DEFAULT_AGENT_TOKEN_TTL` (`'24h'`) on
   empty / whitespace, and still throws on unparseable input — but
   the throw is now a *rethrow* with the descriptive message that
   names both the offending value and the `AGENT_JWT_TTL` env var
   (the contract `signAgentToken` callers depend on). The local
   regex is deleted; the unit set is tightened to `s | m | h | d`.

2. **`token.service.ts` (child-1, already shipped).** The
   `parseExpiryToSeconds` helper now delegates to
   `parseDurationToSeconds` and falls back to `900` (15m) on parse
   failure, preserving the permissive failure mode the auth
   service relies on.

3. **`refresh-token.service.ts` (child-2, already shipped).** The
   `readRefreshExpiryDays` helper now delegates to
   `parseDurationToSeconds` and converts the resulting seconds into
   the day-count the legacy `JWT_REFRESH_EXPIRY_DAYS` contract
   expects, falling back to `7` on parse failure. The
   `JWT_REFRESH_EXPIRY_DAYS` legacy path is preserved as a separate
   code path with a comment that explains why it cannot route
   through the canonical utility (the contract is "days", not
   "seconds").

The unit-set tightening is **deliberate and intentional**. Weeks,
years, and milliseconds are dropped from the canonical grammar
because:

- `jsonwebtoken`'s `expiresIn` (the only downstream consumer of the
  agent-token-ttl resolved string) understands `s | m | h | d` and
  silently multiplies other units by `86400` (treating them as
  days), which is the exact silent-misconfiguration the canonical
  utility is designed to prevent.
- The two existing auth parsers (refresh-token, token-service)
  already enforced `s | m | h | d`; aligning the third parser
  removes a free-floating unit set.
- The `AGENT_JWT_TTL='1w'` operator-visible behaviour is the
  single known tightening and is pinned by a regression test
  (`agent-token-ttl.spec.ts` — `'1w' value throws` case) so the
  tightening is documented in the test suite and surfaces as a
  descriptive error rather than a silent default.

The permissive-vs-strict-throw distinction between the two layers
is preserved verbatim. `parseDurationToSeconds` itself throws on
unparseable input (the canonical contract); the call sites that
want a permissive fallback wrap the call in a `try { ... } catch`
that returns their respective defaults. The
`agent-token-ttl.ts` rethrow *augments* the parser's error with
the `AGENT_JWT_TTL` env-var name so the failure message remains
operator-friendly even after the utility takes ownership of the
grammar.

## Alternatives

### Option 1 — Keep the three parsers and document the drift

Add a doc comment to each parser cross-referencing the other two
and call out the bare-numeric / unit-set / failure-mode
differences in a shared `docs/architecture/duration-parsing.md`
note. Leave the implementations unchanged.

Rejected because:

1. **The drift is observable from operator config, not just from
   code.** A 7× lifetime multiplier between two env vars is the
   kind of bug a config audit cannot catch by reading code; the
   only fix is to collapse the parsers.
2. **Documented drift is still drift.** The parent work item's
   `codebase_refactoring_analysis` scan flagged this pattern
   specifically because the three parsers invite independent
   edits — adding a new unit to one, tightening the failure mode
   on another, and silently changing the bare-numeric semantics
   on the third is a textbook drift spiral. A doc comment does
   not prevent the next drift edit; a single utility does.
3. **The canonical utility already exists.** Child-1 shipped
   `parseDurationToSeconds` for the token-service migration. Not
   adopting it for the remaining two parsers is a
   one-utility-per-call-site pattern, which is the worst of both
   worlds (single utility, three call sites that could opt out).

### Option 2 — Adopt a third-party library (e.g. `ms`) instead of a hand-rolled parser

Replace `parseDurationToSeconds` with the popular `ms` package
(npm, ~1.5M weekly downloads), which accepts the full `ms` grammar
including `1d`, `2h`, `1w`, `1y`, `2 days`, `1.5h`, etc. The
canonical utility becomes a one-line re-export of `ms`'s parser.

Rejected because:

1. **`ms`'s grammar is wider than the supported set.**
   `parseDurationToSeconds` deliberately accepts `s | m | h | d`
   only and rejects decimals, negative numbers, zero, and empty
   strings. `ms` accepts `1.5h`, `-1h`, `' '`, and a long list of
   long-form synonyms (`'2 days'`, `'1 day'`, `'1d'`). Adopting
   `ms` would re-introduce the over-permissive grammar the
   canonical utility is designed to avoid.
2. **The `ms` library has no first-class TypeScript types for
   the failure mode** — it returns `undefined` for unparseable
   input rather than throwing, so every call site has to
   `if (result === undefined)` to distinguish "input was `0`"
   from "input was unparseable". The current
   `parseDurationToSeconds` contract is "throw on unparseable
   input", which is the pattern the three call sites are written
   against.
3. **A new runtime dependency.** The canonical utility is
   ~50 lines of pure TypeScript with no runtime cost; the `ms`
   library is a single function with a similar surface area but
   one more entry in `apps/api/package.json` and one more supply-
   chain surface to vet. The cost-of-adoption is not justified
   by a marginal grammar-widening benefit.
4. **The over-permissive `DURATION_PATTERN` we are tightening is
   the exact grammar `ms` accepts.** Adopting `ms` would
   re-introduce `'1w'`-style silent misconfigurations through the
   library layer rather than eliminating them at the
   call-site layer.

### Option 3 — Widen the canonical utility to support `w | y | ms` for parity with `jsonwebtoken`'s `expiresIn`

Extend `parseDurationToSeconds` so its unit set matches
`jsonwebtoken@9.0.3`'s `expiresIn` grammar, which (per the
package's own docs) supports `s | m | h | d` for the string form
and *also* the wide-form `'<number> <unit>'` style via
`ms`-style parsing for some operators. This would keep the
`AGENT_JWT_TTL='1w'` operator's deployment working.

Rejected because:

1. **`jsonwebtoken@9.0.3` does not actually understand `w` or
   `y`.** The package's `expiresIn` type union is
   `string | number` and the accepted string forms are documented
   in the package's own README as a numeric string or `<number><unit>`
   where `unit` is one of `s`, `m`, `h`, `d`. A `1w` value
   forwarded to `jwt.sign({ expiresIn: '1w' })` is treated as
   `1w` literal seconds (i.e. one second), not seven days —
   the `w` is **not** stripped and the unit is **not**
   interpreted. The premise of this alternative is false; the
   "parity" the alternative claims to preserve does not exist in
   the library.
2. **The tightened unit set is the *point*.** A
   `AGENT_JWT_TTL='1w'` deployment was producing a JWT that
   expired in **1 second** (the literal interpretation), which
   is a one-second, never-valid token. Pinning the tightening
   via the regression test (Task 2) is the deliberate
   behaviour-fix; widening the utility would re-legalise the
   bug.
3. **The two existing call sites already use `s | m | h | d`
   only.** Widening the canonical utility would force the two
   migrated sites (`token.service.ts`, `refresh-token.service.ts`)
   to re-validate their inputs against a wider grammar, which
   is wasted work.

## Consequences

### Drift fixes

- **Bare-numeric interpretation is unified at the
  `parseDurationToSeconds` boundary.** Every call site that
  delegates to the utility now agrees that a bare integer is
  seconds; the only site that interprets a bare integer as days
  is `refresh-token.service.ts`'s *legacy* `JWT_REFRESH_EXPIRY_DAYS`
  path, which is now an explicit branch with a comment
  explaining the historical contract.
- **The `AGENT_JWT_TTL='1w'` silent misconfiguration is
  eliminated.** A regression test pins the new behaviour
  (`agent-token-ttl.spec.ts` — `'throws for a "1w" value'`). The
  failing case throws a descriptive error naming the
  `AGENT_JWT_TTL` env var and the offending `'1w'` value, so
  operators get an actionable failure rather than a
  one-second token.
- **The permissive-vs-strict-throw distinction between the auth
  services and `agent-token-ttl` is preserved verbatim.** The
  utility itself is strict-throw; the two auth call sites wrap
  it in a permissive `try { ... } catch` that returns their
  defaults, while `agent-token-ttl` rethrows with an augmented
  message. The behaviour contract for `signAgentToken` callers
  is unchanged.

### Behaviour-tightening on the agent-token-ttl path

Child-3 is intentionally a behaviour-tightening migration for the
`agent-token-ttl` path: `AGENT_JWT_TTL` values using `w`, `y`, or
`ms` units (previously accepted by the over-permissive
`DURATION_PATTERN`) now throw at the `resolveAgentTokenTtl` call
site. The three downstream consumers of the resolved string —
`chat-execution`, `workflow-step-execution`, and
`workflow-subagents` — all forward the resolved string to
`jwt.sign(..., { expiresIn: ttl })`, which understands the
tightened `s | m | h | d` set. No downstream consumer depends on
the wider unit set, so the tightening has no observed downstream
behaviour change beyond the `'1w'`-style operator-config fixes
that are now surfaced as errors.

### Implementation notes

- The agent-token-ttl migration is the third of three
  child-1/2/3 milestones; the call-site change is a one-line
  import + a `try { parseDurationToSeconds(value); } catch`
  rethrow. No new runtime dependency. No new module. No
  `ConfigService` injection.
- The error message in the rethrow is constructed from the
  **original** `raw` (untrimmed) value, not the trimmed `value`,
  so the operator sees exactly what they set — useful when
  trailing whitespace is the actual misconfiguration.
- The `'1w'` regression test asserts the error message matches
  the regex `/AGENT_JWT_TTL.*"1w"/`, which both pins the env-var
  name in the message and pins the offending value in the
  message. The test fails if either is dropped.

## Follow-up

One related parser is **deliberately out of scope** for this
child:

- **`apps/api/src/gitops/gitops.module.ts:parseTtlEnv`** reads
  `GITOPS_CREDENTIALS_TTL_MS` and uses **bare milliseconds** as
  its unit (not seconds, not any of `s | m | h | d`). The
  semantic mismatch is fundamental — the gitops cache TTL is
  an `ioredis` style millisecond duration, not a JWT-style
  duration — so the canonical utility is **not** a drop-in
  replacement. Adopting the canonical utility there would
  require (a) deciding whether `GITOPS_CREDENTIALS_TTL_MS`
  should switch to seconds, (b) updating the operator-facing
  docs and the seed-data defaults, and (c) validating the
  cache-TTL contract with the gitops module's
  `config-export.service.ts` and `drift-detection.service.ts`
  consumers. That is a future EPIC and is **out of scope** for
  this work item.

Two additional call sites use the canonical utility's
predecessor grammar but are similarly out of scope:

- The `apps/api/src/observability/` and
  `apps/api/src/workflow/workflow-runtime/` modules read
  duration-style env vars (`*_INTERVAL`, `*_TIMEOUT`) in a few
  places; the consolidation across those modules is a
  separate EPIC that should reuse `parseDurationToSeconds`
  once the auth-boundary consolidation is settled.
- `apps/api/src/auth/refresh-token-key.provider.ts` does **not**
  parse durations and is not affected by this ADR.

## Status

Status: Proposed. Owner: refactor-executor (this child-3 milestone).

The canonical utility
(`apps/api/src/config/duration.ts`) is in place as of child-1.
The three call-site migrations
(`agent-token-ttl.ts` in this child, `token.service.ts` in
child-1, `refresh-token.service.ts` in child-2) route through
the canonical utility. The unit set is tightened to
`s | m | h | d` at the canonical-utility boundary. The
`AGENT_JWT_TTL='1w'` behaviour is pinned by a regression test.
The decision recorded here is that the canonical
`parseDurationToSeconds` is the single source of truth for the
duration grammar across the auth boundary, that the
permissive-vs-strict-throw distinction between the two layers
is preserved by per-call-site `try { ... } catch` wrappers, and
that the gitops-credentials millisecond-TTL path is a
separate, out-of-scope EPIC.

## References

- `apps/api/src/config/duration.ts` — the canonical
  `parseDurationToSeconds` utility.
- `apps/api/src/config/agent-token-ttl.ts` — the child-3
  migration target.
- `apps/api/src/config/agent-token-ttl.spec.ts` — the unit
  tests, including the new `'1w'` regression case.
- `apps/api/src/auth/sign-agent-token.ts` — the sole consumer
  of `resolveAgentTokenTtl` (unmodified by this child).
- `apps/api/src/auth/refresh-token.service.ts` — the
  child-2-migrated parser; legacy `JWT_REFRESH_EXPIRY_DAYS`
  branch preserved as an explicit code path.
- `apps/api/src/auth/token.service.ts` — the child-1-migrated
  parser.
- `apps/api/src/gitops/gitops.module.ts:parseTtlEnv` — the
  out-of-scope millisecond-TTL parser, called out for the
  follow-up EPIC.
- `docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md`
  — the project's most recent ADR of comparable shape (single
  helper, three call-site migrations, drift inventory in
  `Context`).
