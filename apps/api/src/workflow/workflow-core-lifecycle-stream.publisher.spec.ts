import { CoreWorkflowRunEventEnvelopeV1Schema } from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowCoreLifecycleStreamPublisher } from './workflow-core-lifecycle-stream.publisher';

describe('WorkflowCoreLifecycleStreamPublisher', () => {
  const createEnvelope = () =>
    CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: 'evt-1',
      event_type: 'core.workflow.run.accepted.v1',
      event_version: 'v1',
      occurred_at: '2026-04-29T00:00:00.000Z',
      correlation_id: 'corr-1',
      source_service: 'core',
      payload: {
        run_id: 'run-1',
        workflow_id: 'wf-1',
        status: 'RUNNING',
        context: {
          scopeId: 'project-1',
          contextId: 'project-1',
          contextType: 'external.project',
          metadata: { contextId: 'resource-1' },
        },
      },
      metadata: { requestedBy: 'test', idempotencyKey: 'idem-1' },
    });

  it('appends generic core lifecycle envelopes to the replayable Redis stream', async () => {
    const stream = {
      appendToStream: vi.fn().mockResolvedValue('1714350000000-0'),
    };
    const publisher = new WorkflowCoreLifecycleStreamPublisher(stream as never);
    const envelope = createEnvelope();

    const streamId = await publisher.publish(envelope);

    expect(streamId).toBe('1714350000000-0');
    expect(stream.appendToStream).toHaveBeenCalledWith(
      'stream:core:lifecycle',
      expect.objectContaining({
        event_id: 'evt-1',
        event_type: 'core.workflow.run.accepted.v1',
        run_id: 'run-1',
        workflow_id: 'wf-1',
        occurred_at: '2026-04-29T00:00:00.000Z',
        envelope: JSON.stringify(envelope),
      }),
      expect.objectContaining({ maxLength: 100000 }),
    );
  });

  it('throws when Redis append fails so lifecycle loss is not silent', async () => {
    const stream = {
      appendToStream: vi.fn().mockRejectedValue(new Error('redis down')),
    };
    const publisher = new WorkflowCoreLifecycleStreamPublisher(stream as never);

    await expect(publisher.publish(createEnvelope())).rejects.toThrow(
      'redis down',
    );
  });
});
