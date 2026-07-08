import { ConflictException, NotFoundException } from '@nestjs/common';
import { WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import { WorkflowRuntimeTerminalRunGuardService } from './workflow-runtime-terminal-run-guard.service';

describe('WorkflowRuntimeTerminalRunGuardService', () => {
  const findById = vi.fn();
  let service: WorkflowRuntimeTerminalRunGuardService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WorkflowRuntimeTerminalRunGuardService({
      findById,
    });
    // Reference the port token so the import survives tree-shaking
    // and the spec mirrors the runtime port-injection shape.
    expect(WORKFLOW_RUN_REPOSITORY_PORT).toBeDefined();
  });

  it('allows runtime actions for running workflow runs', async () => {
    findById.mockResolvedValue({ id: 'run-1', status: WorkflowStatus.RUNNING });

    await expect(
      service.assertRunIsActive('run-1', { action: 'step_complete' }),
    ).resolves.toBeUndefined();
  });

  it.each([
    WorkflowStatus.COMPLETED,
    WorkflowStatus.FAILED,
    WorkflowStatus.CANCELLED,
  ])('rejects runtime actions for terminal status %s', async (status) => {
    findById.mockResolvedValue({ id: 'run-1', status });

    await expect(
      service.assertRunIsActive('run-1', { action: 'set_job_output' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports missing workflow runs as not found', async () => {
    findById.mockResolvedValue(null);

    await expect(
      service.assertRunIsActive('missing-run', { action: 'step_complete' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
