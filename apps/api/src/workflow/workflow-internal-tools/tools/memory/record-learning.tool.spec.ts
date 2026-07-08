import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import type { InternalToolExecutionContext } from '@nexus/core';
import { INTERNAL_TOOL_HANDLER } from '../../../../tool/internal-tool.tokens';
import { RECORD_LEARNING_RUNTIME_CAPABILITY } from '../../../workflow-runtime/workflow-runtime-capability.contracts';
import { RecordLearningHandler } from '../../handlers/record-learning.handler';
import { WorkflowInternalToolsModule } from '../../workflow-internal-tools.module';
import { RecordLearningTool } from './record-learning.tool';

describe('RecordLearningTool', () => {
  it('exposes the record_learning runtime capability', () => {
    const tool = new RecordLearningTool({} as RecordLearningHandler);

    expect(tool.getName()).toBe('record_learning');
    expect(tool.getDefinition()).toBe(RECORD_LEARNING_RUNTIME_CAPABILITY);
  });

  it('delegates execution to the memory tools handler', async () => {
    const context: InternalToolExecutionContext = {
      workflowRunId: 'run-ctx',
      jobId: 'job-ctx',
    };
    const params = {
      scope_type: 'workflow_run',
      scope_id: 'run-ctx',
      lesson: 'Keep learning submission governed.',
      evidence: [
        {
          kind: 'workflow_run',
          id: 'run-ctx',
          summary: 'Task 3 is only shell registration.',
        },
      ],
      confidence: 0.91,
      tags: ['learning'],
    };
    const recordLearning = vi.fn().mockResolvedValue({
      status: 'pending',
      candidate_id: 'candidate-1',
      created: true,
      fingerprint: 'fingerprint-1',
    });
    const memoryTools = {
      recordLearning,
    } as unknown as RecordLearningHandler;
    const tool = new RecordLearningTool(memoryTools);

    const result = await tool.execute(context, params);

    expect(recordLearning).toHaveBeenCalledWith(context, params);
    expect(result).toEqual({
      status: 'pending',
      candidate_id: 'candidate-1',
      created: true,
      fingerprint: 'fingerprint-1',
    });
  });

  it('returns the governed learning candidate response from the handler', async () => {
    const memoryTools = {
      recordLearning: vi.fn().mockResolvedValue({
        status: 'pending',
        candidate_id: 'candidate-1',
        created: false,
        fingerprint: 'fingerprint-1',
      }),
    } as unknown as RecordLearningHandler;
    const tool = new RecordLearningTool(memoryTools);

    const result = await tool.execute(
      { workflowRunId: 'run-ctx', jobId: 'job-ctx' },
      {
        scope_type: 'workflow_run',
        scope_id: 'run-ctx',
        lesson: 'Keep learning submission governed.',
        evidence: [
          {
            kind: 'workflow_run',
            id: 'run-ctx',
            summary: 'Task 3 is only shell registration.',
          },
        ],
        confidence: 0.91,
        tags: ['learning'],
      },
    );

    expect(result).toEqual({
      status: 'pending',
      candidate_id: 'candidate-1',
      created: false,
      fingerprint: 'fingerprint-1',
    });
  });

  it('registers as an internal tool handler provider', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      WorkflowInternalToolsModule,
    ) as unknown[];
    const internalToolProvider = providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === INTERNAL_TOOL_HANDLER,
    ) as { inject: unknown[] } | undefined;

    expect(providers).toContain(RecordLearningTool);
    expect(internalToolProvider?.inject).toContain(RecordLearningTool);
  });
});
