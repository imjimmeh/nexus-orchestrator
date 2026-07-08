import { describe, expect, it, vi } from 'vitest';
import type Docker from 'dockerode';
import { WorkflowContainerCleanupService } from './workflow-container-cleanup.service';

describe('WorkflowContainerCleanupService', () => {
  const createService = (docker?: Docker) =>
    new WorkflowContainerCleanupService(docker);

  const createContainerApi = () => ({
    kill: vi.fn().mockResolvedValue(undefined),
  });

  const createDockerMock = (
    overrides: {
      listContainers?: ReturnType<typeof vi.fn>;
      getContainer?: ReturnType<typeof vi.fn>;
    } = {},
  ) => {
    const containerApi = createContainerApi();
    return {
      listContainers: overrides.listContainers ?? vi.fn().mockResolvedValue([]),
      getContainer:
        overrides.getContainer ?? vi.fn().mockReturnValue(containerApi),
      containerApi,
    };
  };

  it('returns 0 when docker is undefined', async () => {
    const service = createService();

    const result = await service.stopManagedContainersForRun('run-1');

    expect(result).toBe(0);
  });

  it('lists containers with the managed + workflow_run_id label filter', async () => {
    const { listContainers } = createDockerMock();

    const service = createService({
      listContainers,
      getContainer: vi.fn().mockReturnValue(createContainerApi()),
    } as unknown as Docker);

    await service.stopManagedContainersForRun('run-42');

    expect(listContainers).toHaveBeenCalledWith({
      all: true,
      filters: {
        label: ['nexus.managed=true', 'nexus.workflow_run_id=run-42'],
      },
    });
  });

  it('kills each returned container and returns the stop count', async () => {
    const containerApi = createContainerApi();
    const listContainers = vi
      .fn()
      .mockResolvedValueOnce([{ Id: 'container-1' }, { Id: 'container-2' }]);
    const getContainer = vi.fn().mockReturnValue(containerApi);

    const service = createService({
      listContainers,
      getContainer,
    } as unknown as Docker);

    const result = await service.stopManagedContainersForRun('run-1');

    expect(result).toBe(2);
    expect(getContainer).toHaveBeenCalledWith('container-1');
    expect(getContainer).toHaveBeenCalledWith('container-2');
    expect(containerApi.kill).toHaveBeenCalledTimes(2);
  });

  it('warns and decrements the count when a per-container kill fails', async () => {
    const warn = vi.fn();
    const containerApi = {
      kill: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('already removed'))
        .mockResolvedValueOnce(undefined),
    };
    const listContainers = vi
      .fn()
      .mockResolvedValueOnce([
        { Id: 'container-1' },
        { Id: 'container-2' },
        { Id: 'container-3' },
      ]);
    const getContainer = vi.fn().mockReturnValue(containerApi);

    const service = createService({
      listContainers,
      getContainer,
    } as unknown as Docker);

    // Spy on logger to confirm warn fires without leaking to global logs.
    (service as unknown as { logger: { warn: typeof warn } }).logger = {
      warn,
    };

    const result = await service.stopManagedContainersForRun('run-7');

    expect(result).toBe(2);
    expect(containerApi.kill).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(
      'Failed to kill container container-2 for run run-7: already removed',
    );
  });

  it('warns and returns 0 when listContainers fails', async () => {
    const warn = vi.fn();
    const listContainers = vi
      .fn()
      .mockRejectedValueOnce(new Error('docker daemon unreachable'));
    const getContainer = vi.fn().mockReturnValue(createContainerApi());

    const service = createService({
      listContainers,
      getContainer,
    } as unknown as Docker);

    (service as unknown as { logger: { warn: typeof warn } }).logger = {
      warn,
    };

    const result = await service.stopManagedContainersForRun('run-9');

    expect(result).toBe(0);
    expect(getContainer).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Failed to list containers for workflow run run-9: docker daemon unreachable',
    );
  });
});
