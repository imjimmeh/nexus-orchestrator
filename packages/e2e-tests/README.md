# E2E Tests

End-to-end and functional tests that run against a live API and telemetry gateway.

## Commands

From the monorepo root:

```bash
npm run test:e2e
```

Run the long-form kanban lifecycle script:

```bash
npm run test:e2e:kanban
```

Run through a specific lifecycle checkpoint phase:

```bash
RUN_E2E_TESTS=true KANBAN_TARGET_PHASE=4 npm run test --workspace=packages/e2e-tests -- src/kanban-lifecycle/phase4-ready-to-merge.test.ts
```

Run the QA review workflow test only:

```bash
npm run test:e2e:review
```

Run workflow execution functional scenarios:

```bash
npm run test:functional
```

Run the optional split-service Kanban/Core smoke test:

```bash
npm run test:e2e:split-service:kanban-core
```

This test is skipped unless `RUN_SPLIT_SERVICE_KANBAN_CORE_E2E=true` is set. See `src/split-service-kanban-core/README.md` for auth options, live-stack assumptions, and the `KANBAN_E2E_PROJECT_ID` fixture requirement.

## Environment Variables

- `E2E_API_URL` or `FUNCTIONAL_TEST_API_URL` (default `http://127.0.0.1:3010`)
- `E2E_WS_URL` or `FUNCTIONAL_TEST_WS_URL` (default `http://127.0.0.1:3011`)
- `JWT_SECRET` or `FUNCTIONAL_TEST_JWT_SECRET`
- `FUNCTIONAL_TEST_SCENARIO` (`simple`, `complex`, `tools`, `manager`, `all`)
- `FUNCTIONAL_TEST_TRIGGER_INPUT_JSON` or `FUNCTIONAL_TEST_WORKFLOW_INPUT_JSON`
- `FUNCTIONAL_TEST_ASSERTION_TOKEN`
- `RUN_E2E_TESTS=true` to execute tests that are skipped by default in Vitest

## Notes

- The kanban lifecycle suite is intentionally stateful and long-running.
- The lifecycle currently validates six checkpoints:
  1. Project + scoped work-item creation
  2. In-progress implementation workflow
  3. In-review QA workflow
  4. Ready-to-merge workflow
  5. CEO orchestration bootstrap (start, approval, work-item generation)
  6. Flat dependency auto-dispatch and CEO decision-cycle signaling
- Checkpoint specs are under `src/kanban-lifecycle/phase*.test.ts` for phases 1-6.
- The review and workflow tests are packaged as Vitest specs and can be targeted by file.
