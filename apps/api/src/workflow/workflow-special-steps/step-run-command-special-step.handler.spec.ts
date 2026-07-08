import { describe, expect, it, vi } from 'vitest';
import { StepRunCommandSpecialStepHandler } from './step-run-command-special-step.handler';
import {
  RUN_COMMAND_DEFAULT_TIMEOUT_MS,
  RUN_COMMAND_MAX_TIMEOUT_MS,
} from './step-run-command-special-step.handler.types';
import type { SpecialStepExecutionContext } from './step-special-step.types';

function createContext(
  inputs: Record<string, unknown>,
): SpecialStepExecutionContext {
  return {
    workflowRunId: 'run-1',
    stepId: 'run_gate',
    step: { id: 'run_gate', type: 'run_command', tier: 'heavy' },
    resolvedStepInputs: { command: 'echo hi', ...inputs },
  };
}

describe('StepRunCommandSpecialStepHandler timeout resolution', () => {
  function createHandler() {
    const execFn = vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '' });
    return { execFn, handler: new StepRunCommandSpecialStepHandler(execFn) };
  }

  it('honors a configured timeout_ms below the cap', async () => {
    const { execFn, handler } = createHandler();

    await handler.execute(createContext({ timeout_ms: 600_000 }));

    expect(execFn).toHaveBeenCalledWith(
      'sh',
      ['-c', 'echo hi'],
      expect.objectContaining({ timeout: 600_000 }),
    );
  });

  it('honors the 20-minute quality-gate timeout without clamping it to 5 minutes', async () => {
    const { execFn, handler } = createHandler();

    await handler.execute(createContext({ timeout_ms: 1_200_000 }));

    expect(execFn).toHaveBeenCalledWith(
      'sh',
      ['-c', 'echo hi'],
      expect.objectContaining({ timeout: 1_200_000 }),
    );
  });

  it('clamps a configured timeout_ms above the maximum', async () => {
    const { execFn, handler } = createHandler();

    await handler.execute(
      createContext({ timeout_ms: RUN_COMMAND_MAX_TIMEOUT_MS + 1 }),
    );

    expect(execFn).toHaveBeenCalledWith(
      'sh',
      ['-c', 'echo hi'],
      expect.objectContaining({ timeout: RUN_COMMAND_MAX_TIMEOUT_MS }),
    );
  });

  it('falls back to the default timeout when timeout_ms is absent', async () => {
    const { execFn, handler } = createHandler();

    await handler.execute(createContext({}));

    expect(execFn).toHaveBeenCalledWith(
      'sh',
      ['-c', 'echo hi'],
      expect.objectContaining({ timeout: RUN_COMMAND_DEFAULT_TIMEOUT_MS }),
    );
  });

  it('exposes a maximum timeout large enough to run the full quality-gate suite', () => {
    expect(RUN_COMMAND_MAX_TIMEOUT_MS).toBeGreaterThanOrEqual(1_200_000);
  });
});
