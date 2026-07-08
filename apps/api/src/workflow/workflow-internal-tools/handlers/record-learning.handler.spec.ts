import type { InternalToolExecutionContext } from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import { RecordLearningHandler } from './record-learning.handler';

describe('RecordLearningHandler', () => {
  it('delegates recordLearning to RecordLearningService.recordLearning', async () => {
    const context: InternalToolExecutionContext = {
      workflowRunId: 'run-123',
      jobId: 'job-456',
      scopeId: 'runtime-scope-789',
      userId: 'user-abc',
      agentProfileName: 'repair-agent',
    };
    const params = {
      scope_type: 'workflow_run' as const,
      scope_id: 'run-123',
      lesson: 'Cite evidence before mutating workflow behavior.',
      evidence: [
        {
          kind: 'workflow_run' as const,
          id: 'run-123',
          summary: 'Evidence-first repairs reduce ambiguity.',
        },
      ],
      confidence: 0.78,
      tags: ['repair', 'evidence'],
    };
    const recordLearningService = {
      recordLearning: vi.fn().mockResolvedValue({
        status: 'pending',
        candidate_id: 'candidate-1',
        created: true,
        fingerprint: 'a'.repeat(64),
      }),
    };

    const handler = new RecordLearningHandler(recordLearningService as never);

    const result = await handler.recordLearning(context, params);

    expect(recordLearningService.recordLearning).toHaveBeenCalledTimes(1);
    expect(recordLearningService.recordLearning).toHaveBeenCalledWith(
      context,
      params,
    );
    expect(result).toEqual({
      status: 'pending',
      candidate_id: 'candidate-1',
      created: true,
      fingerprint: 'a'.repeat(64),
    });
  });
});
