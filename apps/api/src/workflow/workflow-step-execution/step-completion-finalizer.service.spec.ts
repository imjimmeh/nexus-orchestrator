import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StepCompletionFinalizerService } from './step-completion-finalizer.service';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';

describe('StepCompletionFinalizerService', () => {
  let service: StepCompletionFinalizerService;
  let executionRepo: {
    findRunningStepByRunAndContext: ReturnType<typeof vi.fn>;
  };
  let publisher: {
    completed: ReturnType<typeof vi.fn>;
    failed: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    executionRepo = {
      findRunningStepByRunAndContext: vi.fn(),
    };

    publisher = {
      completed: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
    };

    service = new StepCompletionFinalizerService(
      executionRepo as unknown as ExecutionRepository,
      publisher as unknown as ExecutionEventPublisher,
    );
  });

  it('emits completed and returns finalized=true when a running step exists and hasFailure=false', async () => {
    executionRepo.findRunningStepByRunAndContext.mockResolvedValue({
      id: 'exec-123',
    });

    const result = await service.finalizeFromAgentEnd({
      workflowRunId: 'run-1',
      contextId: 'ctx-1',
      hasFailure: false,
    });

    expect(publisher.completed).toHaveBeenCalledOnce();
    expect(publisher.completed).toHaveBeenCalledWith('exec-123');
    expect(publisher.failed).not.toHaveBeenCalled();
    expect(result).toEqual({ finalized: true, executionId: 'exec-123' });
  });

  it('emits failed and returns finalized=true when a running step exists and hasFailure=true', async () => {
    executionRepo.findRunningStepByRunAndContext.mockResolvedValue({
      id: 'exec-456',
    });

    const result = await service.finalizeFromAgentEnd({
      workflowRunId: 'run-1',
      contextId: 'ctx-1',
      hasFailure: true,
      failureMessage: 'boom',
    });

    expect(publisher.failed).toHaveBeenCalledOnce();
    expect(publisher.failed).toHaveBeenCalledWith('exec-456', {
      failure_reason: 'agent_error',
      error_message: 'boom',
    });
    expect(publisher.completed).not.toHaveBeenCalled();
    expect(result).toEqual({ finalized: true, executionId: 'exec-456' });
  });

  it('emits nothing and returns finalized=false when no running step row is found', async () => {
    executionRepo.findRunningStepByRunAndContext.mockResolvedValue(null);

    const result = await service.finalizeFromAgentEnd({
      workflowRunId: 'run-1',
      contextId: 'ctx-1',
      hasFailure: false,
    });

    expect(publisher.completed).not.toHaveBeenCalled();
    expect(publisher.failed).not.toHaveBeenCalled();
    expect(result).toEqual({ finalized: false });
  });
});
