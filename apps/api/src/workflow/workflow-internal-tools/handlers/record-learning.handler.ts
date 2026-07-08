import { Injectable } from '@nestjs/common';
import type {
  InternalToolExecutionContext,
  RuntimeRecordLearningBody,
} from '@nexus/core';
import { RecordLearningService } from '../../../memory/learning/record-learning.service';

/**
 * Extracted handler for the `record_learning` runtime capability
 * (refactoring work item: split `MemoryToolsHandler` per public
 * method). Behaviour is identical to the previous aggregate's
 * `recordLearning` implementation — same input shape, same delegation
 * to `RecordLearningService.recordLearning` — so the existing
 * `MemoryToolsHandler recordLearning delegation` describe in
 * `record-learning.service.spec.ts` continues to exercise the write
 * path unchanged until task 3.2 rewires it to target this handler.
 *
 * The constructor surface is intentionally narrow: this handler only
 * needs the single service that owns the actual write path
 * (`RecordLearningService`). All other dependencies the aggregate
 * carries stay on the aggregate, which keeps the wiring graph here
 * honest and the handler trivially mockable.
 */
@Injectable()
export class RecordLearningHandler {
  constructor(private readonly recordLearningService: RecordLearningService) {}

  async recordLearning(
    context: InternalToolExecutionContext,
    params: Omit<RuntimeRecordLearningBody, 'workflow_run_id' | 'job_id'>,
  ): Promise<Record<string, unknown>> {
    return this.recordLearningService.recordLearning(context, params);
  }
}
