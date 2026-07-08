# EPIC-187: E2E Test Modernization and Lifecycle Coverage

**Status:** Implemented
**Priority:** P1
**Created:** 2026-05-17
**Updated:** 2026-05-17
**Owner:** Platform / QA Reliability
**Parent:** EPIC-167
**Depends on:** EPIC-178
**Related:** EPIC-163, EPIC-166, EPIC-167, EPIC-170, EPIC-178, `docs/analysis/ANALYSIS-e2e-test-state-2026-05-17.md`

## Summary

Modernize the E2E test estate so it provides an honest, runnable safety net for Nexus lifecycle behavior across Core API, Kanban service, live-stack workflows, and the web UI. The goal is to eliminate false greens, repair stale tests, align live-stack auth and seed usage, and add deterministic lifecycle coverage that proves real system behavior rather than runner self-reports.

## Problem Statement

The current E2E estate is unreliable. The default root E2E command can complete successfully while skipping all package E2E tests. Several API E2E specs are stale after workflow module decomposition and Kanban service extraction. The live-stack review E2E fails because its generated admin JWT no longer matches the running API auth configuration. The web Playwright suite assumes API and web services are already running and times out when they are not.

The result is a dangerous testing gap: E2E commands can appear green without proving the full lifecycle of project orchestration, Kanban transitions, dispatch, review, merge, repair, diagnostics, retrospectives, or learning candidate proposal.

## Evidence

- `npm run test:e2e` skipped all package tests: 10 skipped files and 12 skipped tests.
- `packages/e2e-tests/src/infra/test-gate.ts` skips `describeE2E` and `itE2E` unless explicitly opted in.
- Root `test:e2e` invokes the package `test` lifecycle, not package `test:e2e`, so the package-level force-run logic is not triggered by default.
- `apps/api/test/workflow-routing.e2e-spec.ts` imports stale workflow controller paths.
- `apps/api/test/work-item-lifecycle-process.e2e-spec.ts` imports a stale Core API work item controller path after work item behavior moved to Kanban.
- `apps/api/test/workflow-event-trigger.e2e-spec.ts` has DI drift around `WorkflowBootstrapValidatorService`.
- `packages/e2e-tests/src/review-workflow/qa-review.test.ts` receives 401 from `/api/tools` with its generated admin JWT.
- `packages/e2e-tests/src/review-workflow/qa-review.test.ts` references stale seed path `apps/api/src/database/seeds/work-item-in-review-default.workflow.yaml`.
- Current seed workflows live under `seed/workflows/`.
- `apps/web/playwright.config.ts` has no `webServer` orchestration.
- Web E2E timed out against a missing API at `http://localhost:3010/api`.
- Legacy scripts remain under `packages/e2e-tests/src/**`.
- Existing coverage does not include EPIC-178 retrospective cadence behavior.

## Goals

- Make E2E commands honest: they must either run meaningful tests or fail with a clear setup message.
- Repair or remove stale API E2E specs.
- Move tests that target Kanban-owned behavior into the Kanban or live-stack test boundary.
- Align live-stack E2E authentication with the current API auth contract.
- Align seed workflow paths with `seed/workflows/`.
- Add service orchestration or explicit fast-fail preflight for Playwright.
- Promote deterministic lifecycle coverage as the first reliable lifecycle gate.
- Replace runner-only summary assertions with independent observations from API responses, persisted state, and event ledger records.
- Add lifecycle coverage for retrospective execution, diagnostics, cooldown/idempotency, manual replay, and learning candidate proposal.
- Remove legacy scripts once modern equivalents cover their behavior.

## Non-Goals

- Do not require every E2E run to execute real LLM-heavy workflows by default.
- Do not make Playwright responsible for proving all backend lifecycle invariants.
- Do not preserve stale API tests through compatibility shims or re-export files.
- Do not add broad sleeps to hide orchestration timing problems.
- Do not make live-stack E2E mutate production-like shared state without explicit isolation or cleanup.

## Workstreams

### 1. Honest E2E Command Semantics

Fix root and package E2E scripts so default behavior is explicit and safe.

Expected changes:

- Decide whether `npm run test:e2e` should run tests by default or fail fast with setup guidance.
- Remove false-green skip behavior from the default command path.
- Keep intentionally optional suites behind explicit env flags and document them as opt-in.
- Ensure `passWithNoTests` cannot hide broken test discovery for active E2E commands.

Acceptance criteria:

- `npm run test:e2e` no longer reports success after skipping every meaningful E2E test.
- If required services or env vars are missing, the command fails with a concise actionable message.
- CI can distinguish skipped optional suites from a successful required E2E gate.

### 2. API E2E Repair and Boundary Cleanup

Repair API in-process specs that still target current Core API behavior and delete or migrate specs that target behavior now owned by Kanban.

Expected changes:

- Update stale workflow controller imports to current module paths.
- Fix DI wiring for `workflow-event-trigger.e2e-spec.ts` or convert it to the appropriate narrower integration test.
- Delete or migrate `work-item-lifecycle-process.e2e-spec.ts` if its target endpoints belong to Kanban.
- Harden setup/teardown so failed module compilation does not cause secondary cleanup errors.

Acceptance criteria:

- API E2E specs collect successfully.
- Specs that remain under `apps/api/test` target Core API-owned behavior only.
- No compatibility re-export files are introduced for stale test paths.

### 3. Live-Stack Auth, Seeds, and Isolation

Make `packages/e2e-tests` align with the current live API and seed layout.

Expected changes:

- Fix review workflow E2E authentication against current `/api/tools` authorization requirements.
- Replace stale seed paths with `seed/workflows/...` paths.
- Document required env vars and service prerequisites.
- Add isolated setup and cleanup for stateful test data where feasible.
- Replace misleading legacy metadata strings such as `legacy-kanban-lifecycle-e2e`.

Acceptance criteria:

- `npm run test:e2e:review` reaches workflow behavior instead of failing on auth setup.
- Seed files are resolved from current source-of-truth paths.
- Live-stack tests identify their created resources and can clean them up or isolate them.

### 4. Deterministic Lifecycle Gate

Establish a deterministic gate that proves the core lifecycle without requiring real AI or brittle live-stack timing.

Expected lifecycle coverage:

- Project creation.
- Work item hydration.
- Refinement routing.
- In-progress execution.
- Review routing.
- QA decision.
- Ready-to-merge or done transition.
- Supervised approval behavior.
- Autonomous dispatch behavior.
- Preflight disabled and preflight required behavior.
- Event-ledger diagnostics for each phase.

Acceptance criteria:

- Deterministic lifecycle tests fail on lifecycle regressions without needing live LLM execution.
- Assertions read independent API, persistence, or event-ledger state rather than only runner summary objects.
- The deterministic gate is documented as the first required lifecycle safety net.

### 5. Web Playwright Reliability

Make the web suite reliable and explicit about dependencies.

Expected changes:

- Add Playwright `webServer` orchestration where practical, or a suite-level preflight that fails before tests begin.
- Keep UI tests focused on UI responsibilities.
- Add backend verification only for a small number of critical UI-driven flows.

Acceptance criteria:

- Web E2E no longer times out for 30 seconds per test when API is unavailable.
- Missing API or web service state produces one clear failure.
- Existing auth, workflow editor, and active-session tests are runnable in a documented local setup.

### 6. Retrospective and Learning Coverage

Add E2E or integration coverage for the lifecycle behaviors introduced by EPIC-178.

Expected coverage:

- Completion-triggered retrospective execution.
- Manual retrospective replay.
- Cooldown gate.
- Idempotency gate.
- Delta gate and skipped reasons.
- Evidence collection.
- `learning.candidate.proposed.v1` event emission.
- Core governed learning candidate creation or reuse.
- Retrospective diagnostics and replayable run history.

Acceptance criteria:

- Retrospective behavior has deterministic coverage for gate logic.
- At least one integration or live-stack test proves the Kanban-to-Core learning proposal path.
- Diagnostics are asserted as user-visible or operator-visible outcomes, not only internal logs.

### 7. Negative-Path and Resilience Coverage

Add targeted failure-path coverage for the highest-risk orchestration seams.

Expected cases:

- Invalid auth token.
- Unauthorized action.
- Bad workflow payload.
- Missing workflow.
- Failed workflow run.
- Timeout or abort.
- Repair dispatch trigger.
- Bad service token between Core and Kanban.
- Partial Kanban/Core outage.

Acceptance criteria:

- Negative-path tests assert stable status codes, error contracts, and observable diagnostics.
- Tests avoid sleeps and use bounded condition-based polling where asynchronous behavior is required.

## Test Strategy

Use a layered E2E strategy:

- API in-process E2E: fast module-boundary and controller routing validation for Core API-owned behavior.
- Kanban or package deterministic E2E: lifecycle logic without real AI dependency.
- Live-stack package E2E: smoke and selected high-value cross-service behavior.
- Web Playwright E2E: UI flows with minimal backend assertions.

## Acceptance Criteria

- `npm run test:e2e` is no longer a false green.
- Stale API import failures are removed by repairing, moving, or deleting the affected specs.
- Review workflow E2E no longer fails at `/api/tools` auth setup when documented env is provided.
- Seed paths point at `seed/workflows/`.
- Web Playwright has service orchestration or clear fast-fail preflight.
- Deterministic lifecycle coverage asserts independent system state across the core Kanban lifecycle.
- EPIC-178 retrospective cadence has deterministic coverage and at least one cross-boundary proposal-path test.
- Legacy `.mjs` E2E artifacts are removed after modern coverage replaces them.
- Documentation explains required commands, env vars, service prerequisites, and which suites are required versus optional.

## Risks

- Full live-stack lifecycle E2E can be slow and flaky if it depends on real AI execution.
- Existing tests may be masking product bugs rather than only test drift.
- Service ownership boundaries may require moving tests between `apps/api`, `apps/kanban`, and `packages/e2e-tests`.
- Fixing command semantics may initially make CI red because skipped failures become visible.

## Implementation Notes

- Prefer deleting stale tests over preserving obsolete paths.
- Prefer deterministic harnesses for required gates and live-stack smoke for expensive scenarios.
- Prefer condition-based polling over fixed sleeps.
- Keep shared contracts in `@nexus/core` and `@nexus/kanban-contracts`; do not redefine response shapes locally when shared contracts exist.
- Do not add lint suppressions or compatibility re-exports to make stale tests pass.
