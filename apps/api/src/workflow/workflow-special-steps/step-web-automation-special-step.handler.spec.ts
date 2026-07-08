import { describe, expect, it, vi } from 'vitest';
import { StepWebAutomationSpecialStepHandler } from './step-web-automation-special-step.handler';
import { WebAutomationActionExecutorService } from '../../web-automation/web-automation-action-executor.service';

describe('StepWebAutomationSpecialStepHandler', () => {
  it('maps web automation executor output into special step result/output', async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        ok: false,
        action: 'click',
        session_id: 'default',
        error: 'Element not found',
        failure_artifact_id: 'artifact-9',
        attempts: [],
      }),
    };

    const handler = new StepWebAutomationSpecialStepHandler(
      executor as unknown as WebAutomationActionExecutorService,
    );

    const result = await handler.execute({
      workflowRunId: 'run-9',
      stepId: 'web-step',
      step: {
        id: 'web-step',
        type: 'web_automation',
        tier: 'light',
      },
      resolvedStepInputs: {
        action: 'click',
        selector: '#submit',
      },
    });

    expect(executor.execute).toHaveBeenCalledWith({
      workflowRunId: 'run-9',
      stepId: 'web-step',
      inputs: {
        action: 'click',
        selector: '#submit',
      },
    });

    expect(result.result).toEqual({
      status: 'completed',
      mode: 'web_automation',
      action: 'click',
      success: false,
      artifactId: 'artifact-9',
      sessionId: 'default',
    });

    expect(result.output).toEqual(
      expect.objectContaining({
        stepId: 'web-step',
        ok: false,
        failure_artifact_id: 'artifact-9',
      }),
    );
  });
});
