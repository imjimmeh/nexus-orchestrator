import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IJob } from '@nexus/core';
import { StepExecutionService } from './step-execution.service';
import { StateMachineService } from '../state-machine.service';
import { StateManagerService } from '../state-manager.service';

describe('StepExecutionService', () => {
  let service: StepExecutionService;
  let stateManager: { setVariable: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    stateManager = {
      setVariable: vi.fn().mockResolvedValue(null),
    };

    service = new StepExecutionService(
      new StateMachineService(),
      stateManager as unknown as StateManagerService,
    );
  });

  const makeJob = (overrides: Partial<IJob> = {}): IJob => ({
    id: 'job-1',
    type: 'execution',
    tier: 'light',
    steps: [
      { id: 'step_1', prompt: 'First' },
      { id: 'step_2', prompt: 'Second' },
    ],
    ...overrides,
  });

  it('executes steps sequentially when no step transitions are defined', async () => {
    const outputsByStep: Record<string, Record<string, unknown>> = {
      step_1: { ok: true, response: 'one' },
      step_2: { ok: true, response: 'two' },
    };

    const result = await service.execute({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: makeJob(),
      stateVariables: {},
      executeStep: (step) => Promise.resolve(outputsByStep[step.id]),
    });

    expect(result.status).toBe('completed');
    expect(result.finalStepId).toBe('step_2');
    expect(result.outputs).toEqual(outputsByStep);
  });

  it('supports conditional step transitions and done target', async () => {
    const result = await service.execute({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: makeJob({
        steps: [
          {
            id: 'step_1',
            prompt: 'First',
            transitions: [
              {
                condition: 'steps.step_1.output.ok == true',
                next: 'done',
              },
            ],
          },
          { id: 'step_2', prompt: 'Second' },
        ],
      }),
      stateVariables: {},
      executeStep: () => Promise.resolve({ ok: true }),
    });

    expect(result.status).toBe('completed');
    expect(result.finalStepId).toBe('step_1');
    expect(result.outputs.step_2).toBeUndefined();
  });

  it('fails when a looping step exceeds max loops', async () => {
    await expect(
      service.execute({
        workflowRunId: 'run-1',
        jobId: 'job-1',
        job: makeJob({
          max_step_loops: 2,
          steps: [
            {
              id: 'step_1',
              prompt: 'Loop',
              transitions: [
                {
                  condition: 'true',
                  next: 'step_1',
                },
              ],
            },
          ],
        }),
        stateVariables: {},
        executeStep: () => Promise.resolve({ ok: true }),
      }),
    ).rejects.toThrow('exceeded max loops');
  });

  it('returns failed status when transition targets fail_job', async () => {
    const result = await service.execute({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: makeJob({
        steps: [
          {
            id: 'step_1',
            prompt: 'First',
            transitions: [
              {
                condition: 'true',
                next: 'fail_job',
              },
            ],
          },
        ],
      }),
      stateVariables: {},
      executeStep: () => Promise.resolve({ ok: true }),
    });

    expect(result.status).toBe('failed');
    expect(result.finalStepId).toBe('step_1');
  });

  it('supports on_error continue and proceeds to next step', async () => {
    const executeStep = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true, response: 'recovered' });

    const result = await service.execute({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: makeJob({
        steps: [
          {
            id: 'step_1',
            type: 'agent',
            prompt: 'First',
            on_error: 'continue',
          },
          { id: 'step_2', type: 'agent', prompt: 'Second' },
        ],
      }),
      stateVariables: {},
      executeStep,
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.step_1).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(result.outputs.step_2).toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(stateManager.setVariable).toHaveBeenCalled();
  });

  it('returns failed status when step returns ok:false and no transitions handle it', async () => {
    const executeStep = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: '402 status code (no body)' })
      .mockResolvedValueOnce({ ok: true });

    const result = await service.execute({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: makeJob({
        steps: [
          { id: 'step_1', type: 'agent', prompt: 'Implement' },
          { id: 'step_2', type: 'run_command', prompt: 'Check' },
        ],
      }),
      stateVariables: {},
      executeStep,
    });

    expect(result.status).toBe('failed');
    expect(result.finalStepId).toBe('step_1');
    expect(result.outputs.step_1).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(result.outputs.step_2).toBeUndefined();
    expect(executeStep).toHaveBeenCalledTimes(1);
  });

  it('allows explicit transitions to handle ok:false step output', async () => {
    const result = await service.execute({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: makeJob({
        steps: [
          {
            id: 'step_1',
            type: 'agent',
            prompt: 'Implement',
            transitions: [
              {
                condition: 'steps.step_1.output.ok == false',
                next: 'done',
              },
            ],
          },
          { id: 'step_2', type: 'run_command', prompt: 'Check' },
        ],
      }),
      stateVariables: {},
      executeStep: () =>
        Promise.resolve({ ok: false, error: 'provider error' }),
    });

    expect(result.status).toBe('completed');
    expect(result.finalStepId).toBe('step_1');
    expect(result.outputs.step_2).toBeUndefined();
  });

  it('respects on_error:continue when step returns ok:false without transitions', async () => {
    const executeStep = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'provider error' })
      .mockResolvedValueOnce({ ok: true, response: 'recovered' });

    const result = await service.execute({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: makeJob({
        steps: [
          {
            id: 'step_1',
            type: 'agent',
            prompt: 'Implement',
            on_error: 'continue',
          },
          { id: 'step_2', type: 'agent', prompt: 'Check' },
        ],
      }),
      stateVariables: {},
      executeStep,
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.step_1).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(result.outputs.step_2).toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(executeStep).toHaveBeenCalledTimes(2);
  });
});
