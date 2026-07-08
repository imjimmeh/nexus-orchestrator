import { describe, expect, it, vi } from 'vitest';
import { IntegrationLifecycleStreamPublisher } from './integration-lifecycle-stream.publisher';

describe('IntegrationLifecycleStreamPublisher.publishPrMerged', () => {
  it('appends a valid core.integration.pr_merged.v1 envelope to the lifecycle stream', async () => {
    const appendToStream = vi.fn().mockResolvedValue('1-0');
    const publisher = new IntegrationLifecycleStreamPublisher({
      appendToStream,
    } as never);

    const id = await publisher.publishPrMerged({
      scopeId: 'scope-1',
      contextId: 'context-1',
      prUrl: 'https://github.com/acme/widgets/pull/42',
      mergeCommitSha: 'sha-merge',
    });

    expect(id).toBe('1-0');
    expect(appendToStream).toHaveBeenCalledTimes(1);
    const [streamKey, fields] = appendToStream.mock.calls[0];
    expect(streamKey).toBe('stream:core:lifecycle');
    expect(fields.event_type).toBe('core.integration.pr_merged.v1');
    const envelope = JSON.parse(fields.envelope);
    expect(envelope.payload).toEqual({
      scopeId: 'scope-1',
      contextId: 'context-1',
      prUrl: 'https://github.com/acme/widgets/pull/42',
      mergeCommitSha: 'sha-merge',
    });
    expect(envelope.source_service).toBe('core');
  });
});

describe('IntegrationLifecycleStreamPublisher.publishPrStatus', () => {
  it('appends a valid core.integration.pr_status.v1 envelope to the lifecycle stream', async () => {
    const appendToStream = vi.fn().mockResolvedValue('2-0');
    const publisher = new IntegrationLifecycleStreamPublisher({
      appendToStream,
    } as never);

    const id = await publisher.publishPrStatus({
      scopeId: 'scope-1',
      contextId: 'context-1',
      prUrl: 'https://github.com/acme/widgets/pull/42',
      checks: 'failing',
      reviewDecision: 'changes_requested',
    });

    expect(id).toBe('2-0');
    expect(appendToStream).toHaveBeenCalledTimes(1);
    const [streamKey, fields] = appendToStream.mock.calls[0];
    expect(streamKey).toBe('stream:core:lifecycle');
    expect(fields.event_type).toBe('core.integration.pr_status.v1');
    const envelope = JSON.parse(fields.envelope);
    expect(envelope.payload).toEqual({
      scopeId: 'scope-1',
      contextId: 'context-1',
      prUrl: 'https://github.com/acme/widgets/pull/42',
      checks: 'failing',
      reviewDecision: 'changes_requested',
    });
    expect(envelope.source_service).toBe('core');
  });
});
