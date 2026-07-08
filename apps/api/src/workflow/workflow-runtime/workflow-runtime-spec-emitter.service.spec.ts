import { describe, expect, it, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowRuntimeSpecEmitterService } from './workflow-runtime-spec-emitter.service';

describe('WorkflowRuntimeSpecEmitterService', () => {
  const mockEmit = vi.fn().mockReturnValue(true);
  const mockEventEmitter = { emit: mockEmit } as unknown as EventEmitter2;

  const service = new WorkflowRuntimeSpecEmitterService(mockEventEmitter);

  it('should emit workflow.specs_ready with specs_ready true', async () => {
    const result = await service.emitSpecsReady({
      scope_id: '25ea21d5-9f53-4eab-86e2-a07f2c0f0900',
      workflow_run_id: '41ad095a-021f-412e-aa24-dfe19b014d32',
    });

    expect(result.ok).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith(
      'workflow.specs_ready',
      expect.objectContaining({
        scope_id: '25ea21d5-9f53-4eab-86e2-a07f2c0f0900',
        workflow_run_id: '41ad095a-021f-412e-aa24-dfe19b014d32',
        trigger: 'spec_revision_complete',
        specs_ready: true,
      }),
    );
  });

  it('should emit with spec_generation_complete trigger when specified', async () => {
    const result = await service.emitSpecsReady({
      scope_id: '25ea21d5-9f53-4eab-86e2-a07f2c0f0900',
      workflow_run_id: 'b4083940-f0c4-4258-98b1-20627787d5a0',
      trigger: 'spec_generation_complete',
    });

    expect(result.ok).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith(
      'workflow.specs_ready',
      expect.objectContaining({
        trigger: 'spec_generation_complete',
        specs_ready: true,
      }),
    );
  });
});
