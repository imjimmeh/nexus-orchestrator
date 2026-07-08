import { describe, expect, it, vi } from 'vitest';
import { TelemetryContainerContextService } from './telemetry-container-context.service';

describe('TelemetryContainerContextService', () => {
  it('returns null when no Docker client is injected (test construction path)', async () => {
    const service = new TelemetryContainerContextService(undefined);
    const result = await service.resolve({ workflowRunId: 'run-1' });
    expect(result).toBeNull();
  });

  it('returns null when Docker returns no matching containers', async () => {
    const listContainers = vi.fn().mockResolvedValue([]);
    const docker = { listContainers } as never;
    const service = new TelemetryContainerContextService(docker);

    const result = await service.resolve({ workflowRunId: 'run-1' });

    expect(result).toBeNull();
    expect(listContainers).toHaveBeenCalled();
  });

  it('returns the newest container matching the workflow run', async () => {
    const listContainers = vi.fn().mockResolvedValue([
      { Id: 'older', Created: 100 },
      { Id: 'newest', Created: 200 },
    ]);
    const docker = { listContainers } as never;
    const service = new TelemetryContainerContextService(docker);

    const result = await service.resolve({ workflowRunId: 'run-1' });

    expect(result).toBe('newest');
  });
});
