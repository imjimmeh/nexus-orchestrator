import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WebAutomationArtifactQueryService } from './web-automation-artifact-query.service';
import { WebAutomationFailureArtifactRepository } from './database/repositories/web-automation-failure-artifact.repository';

describe('WebAutomationArtifactQueryService', () => {
  it('returns run artifact summaries', async () => {
    const repository = {
      findByWorkflowRunId: vi.fn().mockResolvedValue([
        [
          {
            id: 'artifact-1',
            workflow_run_id: 'run-1',
            step_id: 'step-1',
            action_name: 'click',
            attempt_count: 2,
            duration_ms: 500,
            error_message: 'Timed out',
            dom_snapshot_hash: 'abc',
            created_at: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        1,
      ]),
      findById: vi.fn(),
    };

    const service = new WebAutomationArtifactQueryService(
      repository as unknown as WebAutomationFailureArtifactRepository,
    );

    const result = await service.listRunArtifacts('run-1', 20, 0);

    expect(result.total).toBe(1);
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        id: 'artifact-1',
        action_name: 'click',
      }),
    );
  });

  it('throws when artifact is missing for the requested run', async () => {
    const repository = {
      findByWorkflowRunId: vi.fn(),
      findById: vi.fn().mockResolvedValue(null),
    };

    const service = new WebAutomationArtifactQueryService(
      repository as unknown as WebAutomationFailureArtifactRepository,
    );

    await expect(
      service.getRunArtifact('run-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
