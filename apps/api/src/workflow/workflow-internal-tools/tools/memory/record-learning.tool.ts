import { Injectable } from '@nestjs/common';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
  RuntimeRecordLearningBody,
} from '@nexus/core';
import { RECORD_LEARNING_RUNTIME_CAPABILITY } from '../../../workflow-runtime/workflow-runtime-capability.contracts';
import { RecordLearningHandler } from '../../handlers/record-learning.handler';

type RecordLearningParams = Omit<
  RuntimeRecordLearningBody,
  'workflow_run_id' | 'job_id'
>;

@Injectable()
export class RecordLearningTool implements IInternalToolHandler<RecordLearningParams> {
  constructor(private readonly recordLearningHandler: RecordLearningHandler) {}

  getName(): string {
    return 'record_learning';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return RECORD_LEARNING_RUNTIME_CAPABILITY;
  }

  execute(
    context: InternalToolExecutionContext,
    params: RecordLearningParams,
  ): Promise<Record<string, unknown>> {
    return this.recordLearningHandler.recordLearning(context, params);
  }
}
