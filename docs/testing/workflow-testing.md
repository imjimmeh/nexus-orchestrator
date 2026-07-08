# Workflow Testing

This guide documents the EPIC-070 workflow testing DSL and dry-run validation approach.

## Goals

- Validate workflow graph changes without side effects.
- Verify transition/status intent quickly in CI.
- Keep tests deterministic with mocked job outputs.

## Core API

`WorkflowTestHarness` is available at `apps/api/src/workflow/testing/workflow-test-harness.ts`.

Methods:

1. `withTrigger(data)` - set workflow trigger payload.
2. `withState(variables)` - attach initial dry-run state context.
3. `mockJob(jobId, output)` - attach deterministic mock output metadata.
4. `run()` - execute dry-run and return execution diagnostics.

## Example

```typescript
import { workflowTest } from '../../apps/api/src/workflow/testing/workflow-test-harness';

const result = await workflowTest(workflowEngine, 'resource_in_progress_default')
  .withTrigger({ scopeId: 'scope-1', contextId: 'resource-1' })
  .mockJob('implement_and_commit', { ok: true })
  .run();

expect(result.stateTransitions).toContain('verified');
```

## Dry-Run Behavior

Dry-run mode:

1. Parses and validates workflow definition.
2. Resolves external prompt files.
3. Computes DAG ordering and parallel groups.
4. Returns transition targets without queuing jobs or writing run rows.

## Best Practices

1. Keep workflow tests focused on one orchestration path per test.
2. Use stable trigger payload fixtures.
3. Prefer explicit assertions on `executionPath` and `stateTransitions`.
4. Add regression tests for any workflow prompt extraction or transition changes.
