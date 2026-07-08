import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  SpecsReadyInput,
  SpecsReadyResult,
} from './workflow-runtime-spec-emitter.service.types';

@Injectable()
export class WorkflowRuntimeSpecEmitterService {
  private readonly logger = new Logger(WorkflowRuntimeSpecEmitterService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  emitSpecsReady(input: SpecsReadyInput): SpecsReadyResult {
    const trigger = input.trigger ?? 'spec_revision_complete';
    const event_id = `specs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    this.logger.log(
      `Emitting specs_ready signal for scope ${input.scope_id} (trigger: ${trigger})`,
    );

    this.eventEmitter.emit('workflow.specs_ready', {
      scope_id: input.scope_id,
      workflow_run_id: input.workflow_run_id,
      trigger,
      specs_ready: true,
      emitted_at: new Date().toISOString(),
      event_id,
    });

    return { ok: true, event_id };
  }
}
