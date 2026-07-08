import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ISpecialStepHandler,
  SpecialStepExecutionContext,
  SpecialStepHandlerResult,
} from './step-special-step.types';

@Injectable()
export class StepEmitEventSpecialStepHandler implements ISpecialStepHandler {
  readonly type = 'emit_event' as const;
  readonly descriptor = {
    type: this.type,
    owningDomain: 'core',
    inputContract: 'inputs.event_name',
  } as const;

  private readonly logger = new Logger(StepEmitEventSpecialStepHandler.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  execute({
    stepId,
    resolvedStepInputs,
  }: SpecialStepExecutionContext): Promise<SpecialStepHandlerResult> {
    const eventName =
      typeof resolvedStepInputs.event_name === 'string'
        ? resolvedStepInputs.event_name.trim()
        : undefined;

    if (!eventName) {
      return Promise.reject(
        new Error(`Step ${stepId}: emit_event requires inputs.event_name`),
      );
    }

    const payload =
      resolvedStepInputs.payload &&
      typeof resolvedStepInputs.payload === 'object'
        ? (resolvedStepInputs.payload as Record<string, unknown>)
        : {};

    this.eventEmitter.emit(eventName, payload);

    const emittedAt = new Date().toISOString();

    this.logger.log(
      `emit_event [${stepId}]: emitted '${eventName}' at ${emittedAt}`,
    );

    return Promise.resolve({
      result: {
        status: 'completed',
        mode: 'emit_event',
        eventName,
      },
      output: {
        ok: true,
        stepId,
        event_name: eventName,
        emitted_at: emittedAt,
      },
    });
  }
}
