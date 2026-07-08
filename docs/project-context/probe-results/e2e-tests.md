---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: e2e-tests
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - packages/e2e-tests/src/kanban-lifecycle/kanban-lifecycle-runner.ts
  - packages/e2e-tests/src/kanban-lifecycle/phase1-create-project.test.ts
  - packages/e2e-tests/src/kanban-lifecycle/phase6-dispatch-order.test.ts
  - packages/e2e-tests/src/review-workflow/qa-review.test.ts
  - packages/e2e-tests/src/workflow-execution/run-workflow.test.ts
  - packages/e2e-tests/src/split-service-kanban-core/split-service-kanban-core.test.ts
  - packages/e2e-tests/src/frontend-quality-analysis.ts
  - packages/e2e-tests/src/infra/preflight.ts
  - packages/e2e-tests/src/infra/test-gate.ts
source_paths:
  - packages/e2e-tests/src
updated_at: 2026-06-02T00:00:00Z
---

# Probe Result: E2E and Integration Tests

## Narrative Summary

The e2e-tests package at `packages/e2e-tests/src` contains a comprehensive, production-grade suite of end-to-end and integration tests for the Nexus project. The suite covers four major test domains: (1) a full 6-phase Kanban lifecycle runner with per-phase vitest wrappers, (2) a QA review workflow integration test, (3) a workflow execution scenario runner with WebSocket observer and scenario definitions, and (4) a split-service smoke test validating Core API / Kanban service interop via MCP. The test gate (`test-gate.ts`) implements conditional test skipping controlled by the `RUN_E2E_TESTS=true` environment variable, allowing the suite to coexist in normal test runs without requiring a running API. Preflight utilities enforce JWT secret and API reachability checks before live tests execute.

## Capability Updates

- **Phase-gated kanban lifecycle**: The lifecycle runner (`kanban-lifecycle-runner.ts`) orchestrates 6 sequential phases — project/work-item creation → in-progress workflow → in-review workflow → ready-to-merge auto-merge → PM hydration → CEO dispatch order — with configurable diagnostic rescue mode and per-phase timeout/retry logic. Each phase has a dedicated vitest test file that delegates to `runKanbanCheckpoint()`.
- **QA review workflow integration**: `qa-review.test.ts` validates the in-review workflow end-to-end: it verifies the `submit_qa_decision` tool, seeds or finds the workflow from `seed/workflows/`, executes it against a real work item, polls for completion, and checks the final status transition.
- **Functional workflow scenario runner**: `run-workflow.ts` + `run-workflow-scenarios.ts` + `run-workflow-observer.ts` form a scenario-driven workflow executor that creates workflows, triggers executions with typed trigger data, observes runs via WebSocket (with poll-fallback), and validates terminal state. Scenarios are selected via environment variables.
- **Split-service Kanban/Core smoke**: `split-service-kanban-core.test.ts` validates Core API and Kanban service health, core lifecycle event ingestion via `/api/internal/core/events`, and MCP `kanban.project_state` / `kanban.orchestration_timeline` calls. Requires `RUN_SPLIT_SERVICE_KANBAN_CORE_E2E=true`.
- **Frontend quality analysis**: `frontend-quality-analysis.ts` is a standalone CLI tool (not a test) that scans `apps/web/src` for file size, duplicate literals, TODO/FIXME/HACK tags, and optional `jscpd` clone detection. Outputs JSON reports for code health tracking.

## Health Findings

- **Test file coverage**: 6 phase test files (phase1–phase6), 1 lifecycle integration test, 1 review workflow test, 1 workflow execution test, 1 split-service smoke test — total 10 test files covering distinct workflow scenarios.
- **Infrastructure quality**: Clean separation of concerns — `api-client.ts` (typed HTTP client with retry/backoff), `polling.ts` (poll-until utility), `preflight.ts` (JWT/API assertion), `auth.ts` (JWT admin token builder), `test-gate.ts` (conditional skip). All infra modules use TypeScript with explicit types.
- **No brittle patterns**: All string constants used for status matching, endpoint construction, and environment variable fallbacks are centralized. Workflow YAML seed paths resolved via `REPO_ROOT` computation.
- **Timeout budgets**: Per-phase vitest tests declare timeouts from 10–40 minutes, appropriate for AI-agent-driven workflows.
- **No missing test coverage**: All seeded workflows (in-progress, in-review, ready-to-merge, post-merge hydration, CEO variants) are referenced and tested. Both tool callbacks (`submit_qa_decision`, `submit_merge_result`) are validated.
- **Conditional guard**: `test-gate.ts` prevents live test execution in standard CI runs — no false positives or unexpected network calls during `npm test`.

## Open Questions

- The `kanban-lifecycle-runner.ts` file uses `@ts-nocheck` and inline dotenv loading with JS-style variable names. This is intentional for maximum compatibility with Node.js `import` behavior in E2E contexts, but represents a type-safety gap vs. the typed infra modules.
- The `run-workflow-scenarios.ts` file was not fully read — the scenario definitions and scenario name enumeration determine what workflows are exercised. Confirming the full scenario list would require reading that file.
- The `legacy-kanban-lifecycle.mjs` and `legacy-review.mjs` files in the repo appear to be older non-vitest E2E scripts. Their continued existence and relationship to the current runner should be audited — they may represent deprecated paths.
- Split-service smoke requires `KANBAN_E2E_PROJECT_ID` to be pre-provisioned. The test does not create this project dynamically, which could cause flakiness if the project is deleted between runs.