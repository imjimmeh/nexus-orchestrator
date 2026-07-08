import { describe, expect, it } from 'vitest';
import { createSessionCheckpointDebouncer } from './telemetry-gateway-session-checkpoint.helpers';

describe('telemetry-gateway-session-checkpoint.helpers', () => {
  it('debounces checkpoint decisions per checkpoint key', () => {
    let now = 1_000;
    const shouldPersistSessionCheckpoint = createSessionCheckpointDebouncer({
      debounceMs: 1_000,
      now: () => now,
    });

    expect(
      shouldPersistSessionCheckpoint({
        checkpointKey: 'container-1',
        eventType: 'tool_execution_start',
        workflowRunId: 'run-1',
      }),
    ).toBe(true);

    now += 500;

    expect(
      shouldPersistSessionCheckpoint({
        checkpointKey: 'container-1',
        eventType: 'tool_execution_end',
        workflowRunId: 'run-1',
      }),
    ).toBe(false);
    expect(
      shouldPersistSessionCheckpoint({
        checkpointKey: 'container-2',
        eventType: 'tool_execution_end',
        workflowRunId: 'run-1',
      }),
    ).toBe(true);

    now += 500;

    expect(
      shouldPersistSessionCheckpoint({
        checkpointKey: 'container-1',
        eventType: 'turn_end',
        workflowRunId: 'run-1',
      }),
    ).toBe(true);
  });
});
