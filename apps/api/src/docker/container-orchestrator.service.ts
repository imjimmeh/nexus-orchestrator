import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import Docker from 'dockerode';
import { DOCKER_CLIENT } from './docker.constants';
import { normalizeContainerLogs } from './container-log-text.utils';
import {
  assertContainerSurvivedStartup,
  buildContainerCreateOptions,
  isHostShareContainerPath,
  normalizePath,
  POST_START_INSPECTION_DELAY_MS,
  resolveDockerVolumeHostPath,
  resolveDockerWorktreeHostPath,
  resolveHostShareAlias,
  upsertVolume,
} from './container-orchestrator.helpers';
import {
  ContainerTier,
  ContainerState,
  DEFAULT_CHECKPOINT_BASE_DIR,
  IContainerConfig,
  IHostMountBinding,
  IContainerStatus,
  IContainerStats,
} from '@nexus/core';
import { Counter, Gauge } from 'prom-client';
import * as path from 'node:path';
import { hostname } from 'node:os';

@Injectable()
export class ContainerOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(ContainerOrchestratorService.name);
  private readonly defaultNetworkMode =
    process.env.NEXUS_DOCKER_NETWORK?.trim() || 'nexus-network';
  private discoveredHostWorkspacePath: string | null | undefined;

  // Prometheus Metrics
  private readonly containersProvisioned = new Counter({
    name: 'nexus_containers_provisioned_total',
    help: 'Total number of containers provisioned',
  });

  private readonly activeContainers = new Gauge({
    name: 'nexus_active_containers',
    help: 'Number of currently active containers',
  });

  private readonly containerFailures = new Counter({
    name: 'nexus_container_orchestrator_failures_total',
    help: 'Total number of container failures',
  });

  private currentActiveContainers = 0;

  constructor(@Inject(DOCKER_CLIENT) private readonly docker: Docker) {}

  onModuleInit() {
    this.logger.log('ContainerOrchestratorService initialized');
  }

  async provisionContainer(
    config: IContainerConfig,
    start = true,
    enableNetwork = false,
    worktreePath?: string,
  ): Promise<string> {
    try {
      await this.syncManagedContainerCount();

      const maxTotalContainers = Number.parseInt(
        process.env.MAX_TOTAL_CONTAINERS || '10',
        10,
      );
      if (this.currentActiveContainers >= maxTotalContainers) {
        throw new Error(
          `Cannot provision container: max total containers limit (${maxTotalContainers}) reached`,
        );
      }

      const resourceLimits = this.getResourceLimits(config.tier);
      const configuredVolumes = await this.resolveConfiguredVolumes(
        config,
        worktreePath,
      );

      const binds = configuredVolumes.map(
        (v) => `${v.hostPath}:${v.containerPath}${v.readOnly ? ':ro' : ':rw'}`,
      );
      const env = Object.entries(config.env || {}).map(
        ([key, value]) => `${key}=${value}`,
      );
      const configuredContainerUser =
        process.env.NEXUS_WORKTREE_CONTAINER_USER?.trim() || undefined;

      this.logger.debug(
        `Provisioning container with image: ${config.image}, tier: ${config.tier}, network: ${enableNetwork.toString()}`,
      );

      const container = await this.docker.createContainer(
        buildContainerCreateOptions({
          config,
          binds,
          env,
          resourceLimits,
          enableNetwork,
          worktreePath,
          configuredContainerUser,
          defaultNetworkMode: this.defaultNetworkMode,
        }),
      );

      if (start) {
        await container.start();
        await assertContainerSurvivedStartup({
          container,
          delayMs: POST_START_INSPECTION_DELAY_MS,
        });
      }

      this.setActiveContainerCount(this.currentActiveContainers + 1);
      this.containersProvisioned.inc();

      return container.id;
    } catch (e) {
      const error = e as Error;
      this.logger.error(
        `Failed to provision container: ${error.message}`,
        error.stack,
      );
      this.containerFailures.inc();
      throw error;
    }
  }

  private async resolveConfiguredVolumes(
    config: IContainerConfig,
    worktreePath?: string,
  ): Promise<
    Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>
  > {
    const configuredVolumes = [...(config.volumes || [])].map((volume) => ({
      ...volume,
      hostPath: resolveDockerVolumeHostPath({
        hostPath: volume.hostPath,
        hostToolMountPath: process.env.NEXUS_HOST_TOOL_MOUNT_PATH?.trim(),
        toolMountBasePath:
          process.env.NEXUS_TOOL_MOUNT_BASE_PATH?.trim() ||
          path.join('/tmp', 'nexus-tools'),
        hostSkillsLibraryPath: process.env.NEXUS_HOST_SKILLS_PATH?.trim(),
        apiSkillsLibraryPath:
          process.env.NEXUS_SKILLS_LIBRARY_PATH?.trim() ||
          path.join('/data', 'nexus-skills'),
        hostShareMountPath: process.env.NEXUS_HOST_SHARE_MOUNT_PATH?.trim(),
        apiHostShareBasePath:
          process.env.NEXUS_API_HOST_SHARE_BASE_PATH?.trim() ||
          path.join('/data', 'nexus-host-shares'),
        hostCheckpointPath: process.env.NEXUS_HOST_CHECKPOINT_PATH?.trim(),
        checkpointBasePath:
          process.env.NEXUS_CHECKPOINT_BASE_DIR?.trim() ||
          DEFAULT_CHECKPOINT_BASE_DIR,
      }),
    }));
    if (!worktreePath) {
      return configuredVolumes;
    }

    const workspaceBasePath =
      process.env.NEXUS_WORKSPACE_BASE_PATH?.trim() ||
      path.join('/tmp', 'nexus-workspaces');
    const hostWorkspacePath =
      await this.resolveHostWorkspacePath(workspaceBasePath);

    const dockerWorktreeHostPath = resolveDockerWorktreeHostPath({
      worktreePath,
      workspaceBasePath,
      hostWorkspacePath,
    });

    upsertVolume(configuredVolumes, {
      hostPath: dockerWorktreeHostPath,
      containerPath: '/workspace',
      readOnly: false,
    });

    if (!hostWorkspacePath) {
      return configuredVolumes;
    }

    // Worktrees rely on git metadata in the parent repository's .git directory.
    // Bind the workspace base path at its original container path so absolute
    // gitdir references inside worktrees remain resolvable.
    upsertVolume(configuredVolumes, {
      hostPath: hostWorkspacePath,
      containerPath: workspaceBasePath,
      readOnly: false,
    });

    return configuredVolumes;
  }

  private async resolveHostWorkspacePath(
    workspaceBasePath: string,
  ): Promise<string> {
    const configured = process.env.NEXUS_HOST_WORKSPACE_PATH?.trim();
    if (configured) {
      return configured;
    }

    if (this.discoveredHostWorkspacePath !== undefined) {
      return this.discoveredHostWorkspacePath ?? '';
    }

    const discovered = await this.discoverHostWorkspacePath(workspaceBasePath);
    this.discoveredHostWorkspacePath = discovered || null;
    return discovered;
  }

  private async discoverHostWorkspacePath(
    workspaceBasePath: string,
  ): Promise<string> {
    try {
      const selfContainerId = hostname().trim();
      if (!selfContainerId) {
        return '';
      }

      const container = this.docker.getContainer(selfContainerId);
      const inspected = (await container.inspect()) as {
        Mounts?: Array<{ Destination?: string; Source?: string }>;
      };

      const normalizedBasePath = normalizePath(workspaceBasePath);
      const workspaceMount = (inspected.Mounts || []).find(
        (mount) =>
          normalizePath(mount.Destination || '') === normalizedBasePath,
      );

      return workspaceMount?.Source?.trim() || '';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `Unable to auto-detect host workspace path for ${workspaceBasePath}: ${message}`,
      );
      return '';
    }
  }

  async getContainerStatus(containerId: string): Promise<IContainerStatus> {
    const container = this.docker.getContainer(containerId);
    const data = (await container.inspect()) as {
      Id: string;
      Name: string;
      State: { Status: string; Running: boolean };
      Created: string;
      Config: { Image: string };
    };

    return {
      id: data.Id,
      name: data.Name.replace(/^\//, ''),
      state: this.mapState(data.State.Status),
      status: data.State.Status,
      created: new Date(data.Created),
      image: data.Config.Image,
    };
  }

  async getContainerWorkspacePath(
    containerId: string,
  ): Promise<string | undefined> {
    const container = this.docker.getContainer(containerId);
    try {
      const inspected = (await container.inspect()) as {
        Mounts?: Array<{ Destination?: string; Source?: string }>;
      };
      const workspaceMount = (inspected.Mounts || []).find(
        (mount) => normalizePath(mount.Destination || '') === '/workspace',
      );
      return workspaceMount?.Source;
    } catch {
      this.logger.warn(
        `Failed to inspect workspace mount for container ${containerId}`,
      );
      return undefined;
    }
  }

  async getContainerHostMountBindings(
    containerId: string,
  ): Promise<IHostMountBinding[]> {
    const container = this.docker.getContainer(containerId);

    try {
      const inspected = (await container.inspect()) as {
        Mounts?: Array<{ Source?: string; Destination?: string; RW?: boolean }>;
      };

      const bindings: IHostMountBinding[] = [];
      for (const mount of inspected.Mounts || []) {
        const containerPath = normalizePath(mount.Destination || '');
        if (!isHostShareContainerPath(containerPath)) {
          continue;
        }

        const hostPath = mount.Source?.trim();
        const alias = resolveHostShareAlias(containerPath);
        if (!hostPath || !alias) {
          continue;
        }

        const readOnly = mount.RW !== true;
        bindings.push({
          alias,
          hostPath,
          containerPath,
          mode: readOnly ? 'ro' : 'rw',
          readOnly,
        });
      }

      return bindings;
    } catch {
      this.logger.warn(
        `Failed to inspect host-share mounts for container ${containerId}`,
      );
      return [];
    }
  }

  /** Freeze a running container in place via the cgroup freezer (docker pause). */
  async freezeContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.pause();
    this.logger.log(`Paused (froze) container ${containerId}`);
  }

  /**
   * Returns the docker runtime status of a container, or 'missing' when the
   * container no longer exists. Used by resume to decide unpause vs rehydrate.
   */
  async getContainerRuntimeState(
    containerId: string,
  ): Promise<'paused' | 'running' | 'stopped' | 'missing'> {
    try {
      const container = this.docker.getContainer(containerId);
      const data = (await container.inspect()) as {
        State: { Status: string; Running: boolean };
      };
      if (data.State.Status === 'paused') return 'paused';
      if (data.State.Running) return 'running';
      return 'stopped';
    } catch {
      return 'missing';
    }
  }

  async resumeContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    const data = (await container.inspect()) as {
      State: { Status: string; Running: boolean };
    };

    if (data.State.Status === 'paused') {
      await container.unpause();
    } else if (!data.State.Running) {
      await container.start();
    }
    this.logger.log(`Resumed container ${containerId}`);
  }

  async killContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.kill();
    } catch (e) {
      const error = e as Error;
      this.logger.warn(
        `Failed to kill container ${containerId}, it might be already stopped: ${error.message}`,
      );
    }

    await this.syncManagedContainerCount();
  }

  async removeContainer(containerId: string, force = true): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.remove({ force });
    this.logger.log(`Removed container ${containerId}`);

    await this.syncManagedContainerCount();
  }

  private setActiveContainerCount(nextCount: number): void {
    const normalizedCount = Math.max(0, nextCount);
    if (normalizedCount === this.currentActiveContainers) {
      return;
    }

    const delta = normalizedCount - this.currentActiveContainers;
    this.currentActiveContainers = normalizedCount;

    if (delta > 0) {
      this.activeContainers.inc(delta);
      return;
    }

    this.activeContainers.dec(Math.abs(delta));
  }

  private async syncManagedContainerCount(): Promise<void> {
    try {
      const managedRunningContainers = await this.docker.listContainers({
        all: false,
        filters: {
          label: ['nexus.managed=true'],
          status: ['running'],
        },
      });

      this.setActiveContainerCount(managedRunningContainers.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to sync active container count with Docker: ${message}`,
      );
    }
  }

  async getContainerLogs(containerId: string): Promise<NodeJS.ReadableStream> {
    const container = this.docker.getContainer(containerId);
    return container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      timestamps: true,
    });
  }

  async fetchContainerLogSnapshot(
    containerId: string,
    tail = 100,
  ): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);
      const output = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
        tail,
      });
      // A non-TTY container's logs are a multiplexed stream whose frame headers
      // carry NUL bytes; persisting them raw aborts a Postgres INSERT and can
      // wedge the whole run. Sanitize to JSON/Postgres-safe text.
      return normalizeContainerLogs(output) ?? '';
    } catch (error) {
      return `(unable to fetch logs: ${(error as Error).message})`;
    }
  }

  async getContainerStats(containerId: string): Promise<IContainerStats> {
    const container = this.docker.getContainer(containerId);

    const stats = await container.stats({ stream: false });

    // Simple CPU calculation: (cpu_stats.cpu_usage.total_usage - precpu_stats.cpu_usage.total_usage) /
    // (cpu_stats.system_cpu_usage - precpu_stats.system_cpu_usage) * online_cpus

    const cpuDelta =
      stats.cpu_stats.cpu_usage.total_usage -
      stats.precpu_stats.cpu_usage.total_usage;

    const systemDelta =
      stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;

    const cpuUsage =
      systemDelta > 0 && cpuDelta > 0
        ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100
        : 0;

    return {
      cpuUsage,

      memoryUsage: stats.memory_stats.usage,

      memoryLimit: stats.memory_stats.limit,

      timestamp: new Date(stats.read),
    };
  }

  private getResourceLimits(tier: ContainerTier) {
    // MemorySwap is the combined RAM+swap ceiling. Keeping it above Memory lets
    // an agent's anonymous pages spill to the VM's swap under pressure instead
    // of triggering a global OOM-kill (constraint=NONE) when physical RAM is
    // saturated by concurrent harness containers. A 1x swap allowance bounds
    // per-container spill so a single runaway cannot exhaust VM-wide swap.
    if (tier === ContainerTier.HEAVY) {
      return {
        Memory: 4 * 1024 * 1024 * 1024, // 4GB RAM
        NanoCpus: 4 * 1000000000, // 4 CPU cores
        MemorySwap: 8 * 1024 * 1024 * 1024, // 4GB RAM + 4GB swap
      };
    }
    // Default to LIGHT
    return {
      Memory: 512 * 1024 * 1024, // 512MB RAM
      NanoCpus: 1 * 1000000000, // 1 CPU core
      MemorySwap: 1024 * 1024 * 1024, // 512MB RAM + 512MB swap
    };
  }

  private mapState(status: string): ContainerState {
    const map: Record<string, ContainerState> = {
      created: ContainerState.CREATED,
      running: ContainerState.RUNNING,
      paused: ContainerState.PAUSED,
      restarting: ContainerState.RESTARTING,
      removing: ContainerState.UNKNOWN,
      exited: ContainerState.EXITED,
      dead: ContainerState.DEAD,
    };
    return map[status.toLowerCase()] ?? ContainerState.UNKNOWN;
  }
}
