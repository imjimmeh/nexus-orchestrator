import { Test, TestingModule } from '@nestjs/testing';
import { ContainerOrchestratorService } from './container-orchestrator.service';
import { DOCKER_CLIENT } from './docker.constants';
import { ContainerTier } from '@nexus/core';
import { register } from 'prom-client';
import { vi } from 'vitest';
import * as os from 'node:os';

describe('ContainerOrchestratorService', () => {
  let service: ContainerOrchestratorService;
  const originalWorkspaceBasePath = process.env.NEXUS_WORKSPACE_BASE_PATH;
  const originalHostWorkspacePath = process.env.NEXUS_HOST_WORKSPACE_PATH;
  const originalHostToolMountPath = process.env.NEXUS_HOST_TOOL_MOUNT_PATH;
  const originalToolMountBasePath = process.env.NEXUS_TOOL_MOUNT_BASE_PATH;
  const originalHostShareMountPath = process.env.NEXUS_HOST_SHARE_MOUNT_PATH;
  const originalApiHostShareBasePath =
    process.env.NEXUS_API_HOST_SHARE_BASE_PATH;
  const originalHostCheckpointPath = process.env.NEXUS_HOST_CHECKPOINT_PATH;
  const originalCheckpointBaseDir = process.env.NEXUS_CHECKPOINT_BASE_DIR;
  const originalMaxTotalContainers = process.env.MAX_TOTAL_CONTAINERS;

  const dockerMock = {
    createContainer: vi.fn().mockResolvedValue({
      id: 'test-id',
      start: vi.fn().mockResolvedValue({}),
      inspect: vi.fn().mockResolvedValue({
        State: { Status: 'running', ExitCode: 0, Error: '' },
      }),
    }),
    listContainers: vi.fn().mockResolvedValue([]),
    getContainer: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'test-id',
        Name: '/test-name',
        State: { Status: 'running' },
        Created: new Date().toISOString(),
        Config: { Image: 'alpine' },
      }),
      kill: vi.fn().mockResolvedValue({}),
      unpause: vi.fn().mockResolvedValue({}),
      start: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue({}),
      logs: vi.fn().mockResolvedValue({}),
      stats: vi.fn().mockResolvedValue({
        cpu_stats: {
          cpu_usage: { total_usage: 100 },
          system_cpu_usage: 1000,
          online_cpus: 1,
        },
        precpu_stats: { cpu_usage: { total_usage: 50 }, system_cpu_usage: 500 },
        memory_stats: { usage: 1024, limit: 2048 },
        read: new Date().toISOString(),
      }),
    }),
  };

  beforeEach(async () => {
    register.clear();
    vi.clearAllMocks();
    delete process.env.NEXUS_WORKSPACE_BASE_PATH;
    delete process.env.NEXUS_HOST_WORKSPACE_PATH;
    delete process.env.NEXUS_HOST_TOOL_MOUNT_PATH;
    delete process.env.NEXUS_TOOL_MOUNT_BASE_PATH;
    delete process.env.NEXUS_HOST_SHARE_MOUNT_PATH;
    delete process.env.NEXUS_API_HOST_SHARE_BASE_PATH;
    delete process.env.NEXUS_HOST_CHECKPOINT_PATH;
    delete process.env.NEXUS_CHECKPOINT_BASE_DIR;
    delete process.env.MAX_TOTAL_CONTAINERS;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerOrchestratorService,
        {
          provide: DOCKER_CLIENT,
          useValue: dockerMock,
        },
      ],
    }).compile();

    service = module.get<ContainerOrchestratorService>(
      ContainerOrchestratorService,
    );
  });

  afterAll(() => {
    if (originalWorkspaceBasePath === undefined) {
      delete process.env.NEXUS_WORKSPACE_BASE_PATH;
    } else {
      process.env.NEXUS_WORKSPACE_BASE_PATH = originalWorkspaceBasePath;
    }

    if (originalHostWorkspacePath === undefined) {
      delete process.env.NEXUS_HOST_WORKSPACE_PATH;
    } else {
      process.env.NEXUS_HOST_WORKSPACE_PATH = originalHostWorkspacePath;
    }

    if (originalHostToolMountPath === undefined) {
      delete process.env.NEXUS_HOST_TOOL_MOUNT_PATH;
    } else {
      process.env.NEXUS_HOST_TOOL_MOUNT_PATH = originalHostToolMountPath;
    }

    if (originalToolMountBasePath === undefined) {
      delete process.env.NEXUS_TOOL_MOUNT_BASE_PATH;
    } else {
      process.env.NEXUS_TOOL_MOUNT_BASE_PATH = originalToolMountBasePath;
    }

    if (originalHostShareMountPath === undefined) {
      delete process.env.NEXUS_HOST_SHARE_MOUNT_PATH;
    } else {
      process.env.NEXUS_HOST_SHARE_MOUNT_PATH = originalHostShareMountPath;
    }

    if (originalApiHostShareBasePath === undefined) {
      delete process.env.NEXUS_API_HOST_SHARE_BASE_PATH;
    } else {
      process.env.NEXUS_API_HOST_SHARE_BASE_PATH = originalApiHostShareBasePath;
    }

    if (originalHostCheckpointPath === undefined) {
      delete process.env.NEXUS_HOST_CHECKPOINT_PATH;
    } else {
      process.env.NEXUS_HOST_CHECKPOINT_PATH = originalHostCheckpointPath;
    }

    if (originalCheckpointBaseDir === undefined) {
      delete process.env.NEXUS_CHECKPOINT_BASE_DIR;
    } else {
      process.env.NEXUS_CHECKPOINT_BASE_DIR = originalCheckpointBaseDir;
    }

    if (originalMaxTotalContainers === undefined) {
      delete process.env.MAX_TOTAL_CONTAINERS;
    } else {
      process.env.MAX_TOTAL_CONTAINERS = originalMaxTotalContainers;
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('provisionContainer', () => {
    it('should create and start a container', async () => {
      const config = {
        image: 'alpine',
        tier: ContainerTier.LIGHT,
        env: { FOO: 'BAR' },
      };

      const id = await service.provisionContainer(config);

      expect(id).toBe('test-id');
      expect(dockerMock.createContainer).toHaveBeenCalled();
    });

    it('fails fast when a started container exits immediately', async () => {
      dockerMock.createContainer.mockResolvedValueOnce({
        id: 'test-id-early-exit',
        start: vi.fn().mockResolvedValue({}),
        inspect: vi.fn().mockResolvedValue({
          State: {
            Status: 'exited',
            ExitCode: 1,
            Error: 'connection failed',
          },
        }),
      });

      const config = {
        image: 'alpine',
        tier: ContainerTier.LIGHT,
      };

      await expect(
        service.provisionContainer(config, true, true),
      ).rejects.toThrow(/exited shortly after start/);
    });

    it('mounts provided worktree path at /workspace', async () => {
      const config = {
        image: 'alpine',
        tier: ContainerTier.HEAVY,
        volumes: [
          {
            hostPath: '/tmp/workspace',
            containerPath: '/workspace',
            readOnly: false,
          },
        ],
      };

      await service.provisionContainer(config, false, true, '/tmp/worktree');

      expect(dockerMock.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          WorkingDir: '/workspace',
          HostConfig: expect.objectContaining({
            Binds: expect.arrayContaining(['/tmp/worktree:/workspace:rw']),
          }),
        }),
      );
    });

    it('allows HEAVY containers to spill to swap so global OOM is avoided', async () => {
      const config = {
        image: 'alpine',
        tier: ContainerTier.HEAVY,
      };

      await service.provisionContainer(config, false, true);

      const createArg = dockerMock.createContainer.mock.calls.at(-1)?.[0];
      expect(createArg.HostConfig.Memory).toBe(4 * 1024 * 1024 * 1024);
      expect(createArg.HostConfig.MemorySwap).toBe(8 * 1024 * 1024 * 1024);
      expect(createArg.HostConfig.MemorySwap).toBeGreaterThan(
        createArg.HostConfig.Memory,
      );
    });

    it('allows LIGHT containers to spill to swap so global OOM is avoided', async () => {
      const config = {
        image: 'alpine',
        tier: ContainerTier.LIGHT,
      };

      await service.provisionContainer(config, false, true);

      const createArg = dockerMock.createContainer.mock.calls.at(-1)?.[0];
      expect(createArg.HostConfig.Memory).toBe(512 * 1024 * 1024);
      expect(createArg.HostConfig.MemorySwap).toBe(1024 * 1024 * 1024);
      expect(createArg.HostConfig.MemorySwap).toBeGreaterThan(
        createArg.HostConfig.Memory,
      );
    });

    it('maps worktree path from container path to host workspace root', async () => {
      process.env.NEXUS_WORKSPACE_BASE_PATH = '/data/nexus-workspaces';
      process.env.NEXUS_HOST_WORKSPACE_PATH = 'G:/code/nexus/workspaces';

      const config = {
        image: 'alpine',
        tier: ContainerTier.HEAVY,
      };

      await service.provisionContainer(
        config,
        false,
        true,
        '/data/nexus-workspaces/worktrees/pid/wid',
      );

      expect(dockerMock.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Binds: expect.arrayContaining([
              'G:/code/nexus/workspaces/worktrees/pid/wid:/workspace:rw',
              'G:/code/nexus/workspaces:/data/nexus-workspaces:rw',
            ]),
          }),
        }),
      );
    });

    it('auto-detects host workspace root from API container mounts when env is unset', async () => {
      process.env.NEXUS_WORKSPACE_BASE_PATH = '/data/nexus-workspaces';
      delete process.env.NEXUS_HOST_WORKSPACE_PATH;

      const selfContainerId = os.hostname();
      const originalGetContainer = dockerMock.getContainer;

      dockerMock.getContainer = vi
        .fn()
        .mockImplementation((containerId: string) => {
          if (containerId === selfContainerId) {
            return {
              inspect: vi.fn().mockResolvedValue({
                Mounts: [
                  {
                    Destination: '/data/nexus-workspaces',
                    Source: 'G:/code/nexus/workspaces',
                  },
                ],
              }),
            };
          }

          return {
            inspect: vi.fn().mockResolvedValue({
              Id: 'test-id',
              Name: '/test-name',
              State: { Status: 'running' },
              Created: new Date().toISOString(),
              Config: { Image: 'alpine' },
            }),
            kill: vi.fn().mockResolvedValue({}),
            unpause: vi.fn().mockResolvedValue({}),
            start: vi.fn().mockResolvedValue({}),
            remove: vi.fn().mockResolvedValue({}),
            logs: vi.fn().mockResolvedValue({}),
            stats: vi.fn().mockResolvedValue({
              cpu_stats: {
                cpu_usage: { total_usage: 100 },
                system_cpu_usage: 1000,
                online_cpus: 1,
              },
              precpu_stats: {
                cpu_usage: { total_usage: 50 },
                system_cpu_usage: 500,
              },
              memory_stats: { usage: 1024, limit: 2048 },
              read: new Date().toISOString(),
            }),
          };
        });

      const config = {
        image: 'alpine',
        tier: ContainerTier.HEAVY,
      };

      try {
        await service.provisionContainer(
          config,
          false,
          true,
          '/data/nexus-workspaces/worktrees/pid/wid',
        );

        expect(dockerMock.createContainer).toHaveBeenCalledWith(
          expect.objectContaining({
            HostConfig: expect.objectContaining({
              Binds: expect.arrayContaining([
                'G:/code/nexus/workspaces/worktrees/pid/wid:/workspace:rw',
                'G:/code/nexus/workspaces:/data/nexus-workspaces:rw',
              ]),
            }),
          }),
        );
      } finally {
        dockerMock.getContainer = originalGetContainer;
      }
    });

    it('maps tool mount path from container tmp path to host tool mount root', async () => {
      process.env.NEXUS_HOST_TOOL_MOUNT_PATH = 'G:/code/nexus/tool-mounts';
      process.env.NEXUS_TOOL_MOUNT_BASE_PATH = '/tmp/nexus-tools';

      const config = {
        image: 'alpine',
        tier: ContainerTier.HEAVY,
        volumes: [
          {
            hostPath: '/tmp/nexus-tools/run-a/job-b',
            containerPath: '/opt/pi-runner/extensions',
            readOnly: true,
          },
        ],
      };

      await service.provisionContainer(config, false, true);

      expect(dockerMock.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Binds: expect.arrayContaining([
              'G:/code/nexus/tool-mounts/run-a/job-b:/opt/pi-runner/extensions:ro',
            ]),
          }),
        }),
      );
    });

    it('maps host share paths from API mount root to host share root', async () => {
      process.env.NEXUS_HOST_SHARE_MOUNT_PATH =
        'G:/code/nexus/host-share-mounts';
      process.env.NEXUS_API_HOST_SHARE_BASE_PATH = '/data/nexus-host-shares';

      const config = {
        image: 'alpine',
        tier: ContainerTier.HEAVY,
        volumes: [
          {
            hostPath: '/data/nexus-host-shares/project-docs/specs',
            containerPath: '/workspace/host-shares/project-docs/specs',
            readOnly: true,
          },
        ],
      };

      await service.provisionContainer(config, false, true);

      expect(dockerMock.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Binds: expect.arrayContaining([
              'G:/code/nexus/host-share-mounts/project-docs/specs:/workspace/host-shares/project-docs/specs:ro',
            ]),
          }),
        }),
      );
    });

    it('maps checkpoint sidecar path from container tmp path to host checkpoint root', async () => {
      process.env.NEXUS_HOST_CHECKPOINT_PATH = 'G:/code/nexus/checkpoints';
      process.env.NEXUS_CHECKPOINT_BASE_DIR = '/tmp/nexus-checkpoints';

      const config = {
        image: 'alpine',
        tier: ContainerTier.HEAVY,
        volumes: [
          {
            hostPath: '/tmp/nexus-checkpoints/run-a/job-b',
            containerPath: '/opt/pi-runner/agent',
            readOnly: false,
          },
        ],
      };

      await service.provisionContainer(config, false, true);

      expect(dockerMock.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Binds: expect.arrayContaining([
              'G:/code/nexus/checkpoints/run-a/job-b:/opt/pi-runner/agent:rw',
            ]),
          }),
        }),
      );
    });

    it('reconciles active count with Docker before enforcing cap', async () => {
      process.env.MAX_TOTAL_CONTAINERS = '1';

      const config = {
        image: 'alpine',
        tier: ContainerTier.LIGHT,
      };

      await service.provisionContainer(config, false);
      await service.provisionContainer(config, false);

      expect(dockerMock.createContainer).toHaveBeenCalledTimes(2);
      expect(dockerMock.listContainers).toHaveBeenCalledTimes(2);
    });

    it('rejects provisioning when Docker reports cap already reached', async () => {
      process.env.MAX_TOTAL_CONTAINERS = '1';
      dockerMock.listContainers.mockResolvedValueOnce([
        {
          Id: 'already-running-id',
          Labels: { 'nexus.managed': 'true' },
        },
      ]);

      const config = {
        image: 'alpine',
        tier: ContainerTier.LIGHT,
      };

      await expect(service.provisionContainer(config, false)).rejects.toThrow(
        'Cannot provision container: max total containers limit (1) reached',
      );
      expect(dockerMock.createContainer).not.toHaveBeenCalled();
    });
  });

  describe('fetchContainerLogSnapshot', () => {
    it('strips Docker multiplex control bytes so the snapshot is JSON/Postgres-safe', async () => {
      // Non-TTY containers return a multiplexed stream: each frame is prefixed
      // with an 8-byte header [stream-type, 0,0,0, len32] whose NUL bytes would
      // abort a Postgres INSERT ("unsupported Unicode escape sequence").
      const multiplexed = Buffer.concat([
        Buffer.from([2, 0, 0, 0, 0, 0, 0, 18]),
        Buffer.from('npm warn deprecated'),
      ]);
      dockerMock.getContainer.mockReturnValueOnce({
        logs: vi.fn().mockResolvedValue(multiplexed),
      });

      const snapshot = await service.fetchContainerLogSnapshot('test-id');

      expect(snapshot).toContain('npm warn deprecated');
      expect(snapshot.includes(String.fromCharCode(0))).toBe(false);
    });

    it('returns an empty string when the container has no readable logs', async () => {
      dockerMock.getContainer.mockReturnValueOnce({
        logs: vi.fn().mockResolvedValue(Buffer.from('')),
      });

      expect(await service.fetchContainerLogSnapshot('test-id')).toBe('');
    });
  });

  describe('getContainerStatus', () => {
    it('should return mapped status', async () => {
      const status = await service.getContainerStatus('test-id');
      expect(status.id).toBe('test-id');
      expect(status.name).toBe('test-name');
      expect(status.status).toBe('running');
    });
  });

  describe('freezeContainer', () => {
    it('issues docker pause on the container', async () => {
      // Clear prom-client registry before constructing a second service instance
      // directly (the outer beforeEach already constructed one via NestJS module).
      register.clear();
      const pause = vi.fn().mockResolvedValue(undefined);
      const docker = { getContainer: vi.fn().mockReturnValue({ pause }) };
      const svc = new ContainerOrchestratorService(docker);
      await svc.freezeContainer('container-123');
      expect(docker.getContainer).toHaveBeenCalledWith('container-123');
      expect(pause).toHaveBeenCalledTimes(1);
    });
  });

  describe('getContainerRuntimeState', () => {
    it('returns "paused" when the container state is paused', async () => {
      dockerMock.getContainer.mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({
          State: { Status: 'paused', Running: false },
        }),
      });
      const state = await service.getContainerRuntimeState('test-id');
      expect(state).toBe('paused');
    });

    it('returns "running" when the container is running', async () => {
      dockerMock.getContainer.mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({
          State: { Status: 'running', Running: true },
        }),
      });
      const state = await service.getContainerRuntimeState('test-id');
      expect(state).toBe('running');
    });

    it('returns "stopped" when the container exists but is not running or paused', async () => {
      dockerMock.getContainer.mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({
          State: { Status: 'exited', Running: false },
        }),
      });
      const state = await service.getContainerRuntimeState('test-id');
      expect(state).toBe('stopped');
    });

    it('returns "missing" when the container does not exist', async () => {
      dockerMock.getContainer.mockReturnValueOnce({
        inspect: vi.fn().mockRejectedValue(new Error('No such container')),
      });
      const state = await service.getContainerRuntimeState('missing-id');
      expect(state).toBe('missing');
    });
  });
});
