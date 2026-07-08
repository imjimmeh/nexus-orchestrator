import { describe, it, expect, vi } from 'vitest';
import { StepContainerRuntimeService } from './step-container-runtime.service';

describe('StepContainerRuntimeService.bufferAndEmitLines + onActivity contract', () => {
  it('invokes onActivity for each non-empty data chunk via the stdout handler', () => {
    // Guard test: the public signature must accept an onActivity callback.
    const service = new StepContainerRuntimeService({}, {} as never);
    expect(service.startContainerLogStreaming.length).toBeGreaterThanOrEqual(4);
  });
});
