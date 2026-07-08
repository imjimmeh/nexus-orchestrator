import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StepEmitEventSpecialStepHandler } from './step-emit-event-special-step.handler';
import { SpecialStepExecutionContext } from './step-special-step.types';

describe('StepEmitEventSpecialStepHandler', () => {
  let handler: StepEmitEventSpecialStepHandler;
  let mockEventEmitter: { emit: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockEventEmitter = { emit: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StepEmitEventSpecialStepHandler,
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    handler = module.get(StepEmitEventSpecialStepHandler);
  });

  it('should have type "emit_event"', () => {
    expect(handler.type).toBe('emit_event');
  });

  it('emits event with name and payload', async () => {
    const context: SpecialStepExecutionContext = {
      workflowRunId: 'run-001',
      stepId: 'emit_step',
      step: { id: 'emit_step', type: 'emit_event' } as never,
      resolvedStepInputs: {
        event_name: 'ContextMergeCompletedEvent',
        payload: { scope_id: 'proj-1', contextId: 'wi-1' },
      },
    };

    const { result, output } = await handler.execute(context);

    expect(result).toEqual({
      status: 'completed',
      mode: 'emit_event',
      eventName: 'ContextMergeCompletedEvent',
    });
    expect(output.ok).toBe(true);
    expect(output.event_name).toBe('ContextMergeCompletedEvent');
    expect(output.emitted_at).toEqual(expect.any(String));

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'ContextMergeCompletedEvent',
      { scope_id: 'proj-1', contextId: 'wi-1' },
    );
  });

  it('emits event with empty payload when no payload provided', async () => {
    const context: SpecialStepExecutionContext = {
      workflowRunId: 'run-002',
      stepId: 'emit_bare',
      step: { id: 'emit_bare', type: 'emit_event' } as never,
      resolvedStepInputs: {
        event_name: 'SomeEvent',
      },
    };

    const { output } = await handler.execute(context);

    expect(output.ok).toBe(true);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('SomeEvent', {});
  });

  it('throws when event_name is missing', async () => {
    const context: SpecialStepExecutionContext = {
      workflowRunId: 'run-003',
      stepId: 'emit_bad',
      step: { id: 'emit_bad', type: 'emit_event' } as never,
      resolvedStepInputs: {},
    };

    await expect(handler.execute(context)).rejects.toThrow(
      'emit_event requires inputs.event_name',
    );
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('throws when event_name is empty string', async () => {
    const context: SpecialStepExecutionContext = {
      workflowRunId: 'run-004',
      stepId: 'emit_empty',
      step: { id: 'emit_empty', type: 'emit_event' } as never,
      resolvedStepInputs: {
        event_name: '   ',
      },
    };

    await expect(handler.execute(context)).rejects.toThrow(
      'emit_event requires inputs.event_name',
    );
  });

  it('ignores non-object payload', async () => {
    const context: SpecialStepExecutionContext = {
      workflowRunId: 'run-005',
      stepId: 'emit_string_payload',
      step: { id: 'emit_string_payload', type: 'emit_event' } as never,
      resolvedStepInputs: {
        event_name: 'TestEvent',
        payload: 'not-an-object',
      },
    };

    await handler.execute(context);

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('TestEvent', {});
  });
});
