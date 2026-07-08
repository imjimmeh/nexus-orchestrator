# EPIC-035: Lint Hotspot Refactor Wave 1

## Summary

Refactor the highest-risk non-test lint hotspots identified by the repo lint summary to reduce complexity, split oversized modules, and enforce the new type-definition and formatting rules with minimal behavior change.

This epic targets the first wave of files with the largest concentration of lint failures and maintenance risk. It prioritizes safe decomposition, clearer boundaries, and deterministic cleanup sequencing.

## Motivation

### Current Pain Points

1. Orchestration-heavy services have excessive method complexity and size, making behavioral changes risky.
2. Type contracts are concentrated in giant files that violate the new exported-types placement rule.
3. Some files combine formatting churn with logic complexity, obscuring code review signal.
4. Functional test orchestration logic is monolithic and hard to debug.
5. Telemetry and event-mapping code has unsafe assignment patterns that reduce type safety.

### Why Now

1. Stricter linting is now active, and these hotspots block a clean lint baseline.
2. The current hotspots overlap with core orchestration paths where readability and testability are critical.
3. A planned, phased refactor avoids broad risky rewrites while making measurable progress.

## Goals

1. Bring the top 10 worst non-test files into a maintainable shape with reduced complexity and file size pressure.
2. Remove no-restricted-syntax violations caused by exported interfaces/type aliases in non-*.types.ts files.
3. Eliminate mechanical formatting noise in targeted files using explicit formatting-only changes.
4. Improve type safety by addressing unsafe assignment and unnecessary assertion/conversion violations.
5. Preserve runtime behavior by coupling refactors with focused regression tests.

## Non-Goals

1. Re-architecting the entire workflow engine in this epic.
2. Refactoring low-priority files outside the identified hotspot set.
3. Introducing new product behavior or feature scope.
4. Enforcing zero lint errors across the whole repository in a single wave.

## Scope

### In Scope (Wave 1 Target Files)

1. `apps/api/src/docker/container-orchestrator.service.ts`
2. `apps/web/src/lib/api/types.ts`
3. `packages/core/src/interfaces/index.ts`
4. `apps/api/src/project/work-item.service.ts`
5. `packages/functional-tests/src/run-workflow.ts`
6. `apps/api/src/workflow/step-record-metadata-special-step.handler.ts`
7. `packages/pi-runner/src/telemetry-bridge.ts`
8. `apps/api/src/workflow/step-agent-step-executor.service.ts`
9. `apps/api/src/workflow/step-support.service.ts`
10. `apps/web/src/pages/active-session/active-session.utils.ts`

### Out of Scope

1. End-to-end redesign of workflow/job schemas.
2. UI redesign work unrelated to lint-driven maintainability.
3. New orchestration feature development.

## Refactor Strategy

### Phase 1: Mechanical Cleanup and Safety Baseline

1. Separate formatting-only fixes from logic refactors in dedicated commits.
2. Apply low-risk auto-fixes for unnecessary assertions/conversions.
3. Run targeted lint checks per touched file and preserve behavior.

### Phase 2: Type Definition Extraction

1. Split exported interfaces/type aliases/enums from:
   - `apps/web/src/lib/api/types.ts`
   - `packages/core/src/interfaces/index.ts`
   - `apps/api/src/project/work-item.service.ts` (embedded exported types)
2. Create domain-focused `*.types.ts` files and keep index/barrel files export-only.

### Phase 3: API Orchestration Decomposition

1. Break down `step-agent-step-executor.service.ts` into focused collaborators:
   - Container lifecycle orchestration
   - Runner config assembly
   - Workspace mount/path resolution
   - Telemetry publishing wrappers
2. Reduce method complexity and line count for:
   - `executeSingleStepJob`
   - `executeMultiStepJob`

### Phase 4: Workflow Support Decomposition

1. Split `step-support.service.ts` into responsibility-specific modules:
   - Policy normalization/application
   - Upstream context assembly
   - Structured output extraction/parsing
2. Remove duplicated algorithmic branches and simplify control flow.

### Phase 5: Functional Test Runner Modularization

1. Split `packages/functional-tests/src/run-workflow.ts` into:
   - API client helpers
   - Telemetry observation/state machine
   - Scenario builders
   - Scenario validators
   - Entry point orchestrator
2. Reduce deeply nested callback complexity and improve debuggability.

### Phase 6: Telemetry and Metadata Hardening

1. Improve `packages/pi-runner/src/telemetry-bridge.ts` by introducing typed event guards and safer extraction helpers.
2. Refactor `step-record-metadata-special-step.handler.ts` to reduce branching and clean up fixable lint findings.

## Delivery Plan

### Workstream A: Types and File Structure

1. `apps/web/src/lib/api/types.ts`
2. `packages/core/src/interfaces/index.ts`
3. `apps/api/src/project/work-item.service.ts` exported type extraction

### Workstream B: Core Engine Complexity

1. `apps/api/src/workflow/step-agent-step-executor.service.ts`
2. `apps/api/src/workflow/step-support.service.ts`
3. `apps/api/src/docker/container-orchestrator.service.ts`

### Workstream C: Tooling and Telemetry

1. `packages/pi-runner/src/telemetry-bridge.ts`
2. `apps/api/src/workflow/step-record-metadata-special-step.handler.ts`
3. `packages/functional-tests/src/run-workflow.ts`
4. `apps/web/src/pages/active-session/active-session.utils.ts`

## Acceptance Criteria

1. Wave 1 target files have no formatting-only lint noise remaining.
2. no-restricted-syntax violations are removed from targeted non-*.types.ts files via type extraction.
3. `executeSingleStepJob` and `executeMultiStepJob` are decomposed into smaller units with reduced complexity.
4. `step-support.service.ts` high-complexity methods are split into focused helpers/modules.
5. `run-workflow.ts` is modularized so no single function exceeds current lint line thresholds.
6. `telemetry-bridge.ts` no longer reports unsafe assignment in targeted hotspots.
7. Targeted lint command for Wave 1 files passes.
8. Relevant unit/integration tests for touched behavior remain green.

## Risk Management

1. Preserve behavior by introducing characterization tests before major extractions.
2. Keep formatting-only changes isolated from logic changes.
3. Use staged PRs by workstream to limit merge conflict surface.
4. Validate each phase with focused lint and typecheck runs before progressing.

## Validation Commands

1. `npm run lint:summary`
2. `npm exec --workspace=apps/api -- eslint "{src,apps,libs,test}/**/*.ts"`
3. `npm exec --workspace=apps/web -- eslint .`
4. `npm exec -- eslint "packages/**/*.{ts,tsx}"`

## Tracking

- Epic Owner: Platform Engineering
- Status: Proposed
- Priority: High
- Depends On: EPIC-031, EPIC-033, EPIC-034 (shared workflow engine and observability surfaces)
- Follow-up: EPIC-036 (remaining repo-wide lint backlog)
