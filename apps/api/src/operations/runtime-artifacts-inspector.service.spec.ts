import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeArtifactsInspectorService } from './runtime-artifacts-inspector.service';

describe('RuntimeArtifactsInspectorService', () => {
  const docker = {
    listContainers: vi.fn(),
  };
  const workflowRunRepository = {
    findByIds: vi.fn(),
  };

  let service: RuntimeArtifactsInspectorService;
  let tempRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-artifacts-'));
    service = new RuntimeArtifactsInspectorService(
      docker,
      workflowRunRepository as never,
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('reports stale host-share mounts when source path is missing', async () => {
    docker.listContainers.mockResolvedValue([
      {
        Id: 'container-1',
        Names: ['/container-1'],
        Created: Math.floor(Date.now() / 1000),
        Labels: { 'nexus.workflow_run_id': 'run-1' },
        Mounts: [
          {
            Source: path.join(tempRoot, 'missing-host-share-path'),
            Destination: '/workspace/host-shares/project_docs',
          },
        ],
      },
    ]);
    workflowRunRepository.findByIds.mockResolvedValue([{ id: 'run-1' }]);

    const result = await service.inspect();

    expect(result.stale_host_share_mounts).toEqual([
      {
        container_id: 'container-1',
        container_name: 'container-1',
        source_path: path.join(tempRoot, 'missing-host-share-path'),
        destination_path: '/workspace/host-shares/project_docs',
        reason: 'missing_source',
      },
    ]);
  });

  it('reports stale host-share mounts when source path is not a directory', async () => {
    const filePath = path.join(tempRoot, 'host-share-file.txt');
    fs.writeFileSync(filePath, 'not a directory');

    docker.listContainers.mockResolvedValue([
      {
        Id: 'container-2',
        Names: ['/container-2'],
        Created: Math.floor(Date.now() / 1000),
        Labels: { 'nexus.workflow_run_id': 'run-2' },
        Mounts: [
          {
            Source: filePath,
            Destination: '/workspace/host-shares/reports',
          },
        ],
      },
    ]);
    workflowRunRepository.findByIds.mockResolvedValue([{ id: 'run-2' }]);

    const result = await service.inspect();

    expect(result.stale_host_share_mounts).toEqual([
      {
        container_id: 'container-2',
        container_name: 'container-2',
        source_path: filePath,
        destination_path: '/workspace/host-shares/reports',
        reason: 'not_directory',
      },
    ]);
  });
});
