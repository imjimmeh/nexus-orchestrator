import { Inject, Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DOCKER_CLIENT } from '../docker/docker.constants';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowRunRepository } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type {
  RuntimeArtifactsInspection,
  StaleHostShareMountDiagnostic,
} from './runtime-artifacts-inspector.types';

const CONTAINER_STALE_HOURS = 24;
const MOUNT_STALE_HOURS = 24;

@Injectable()
export class RuntimeArtifactsInspectorService {
  private readonly logger = new Logger(RuntimeArtifactsInspectorService.name);

  constructor(
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly workflowRunRepository: IWorkflowRunRepository,
  ) {}

  async inspect(): Promise<RuntimeArtifactsInspection> {
    const managedContainers = await this.docker.listContainers({
      all: true,
      filters: {
        label: ['nexus.managed=true'],
      },
    });

    const workflowRunIds = new Set<string>();
    for (const container of managedContainers) {
      const workflowRunId = container.Labels?.['nexus.workflow_run_id'];
      if (workflowRunId) {
        workflowRunIds.add(workflowRunId);
      }
    }

    const existingRuns = await this.workflowRunRepository.findByIds([
      ...workflowRunIds,
    ]);
    const existingRunIds = new Set(existingRuns.map((run) => run.id));

    const orphanedContainerIds: string[] = [];
    const staleContainerIds: string[] = [];

    for (const container of managedContainers) {
      const workflowRunId = container.Labels?.['nexus.workflow_run_id'];
      if (!workflowRunId || !existingRunIds.has(workflowRunId)) {
        orphanedContainerIds.push(container.Id);
      }

      const createdAtMs = container.Created * 1000;
      const staleCutoffMs = Date.now() - CONTAINER_STALE_HOURS * 60 * 60 * 1000;
      if (createdAtMs < staleCutoffMs) {
        staleContainerIds.push(container.Id);
      }
    }

    const activeMountSources =
      this.collectActiveMountSources(managedContainers);
    const staleMountDirectories =
      await this.collectStaleMountDirectories(activeMountSources);
    const staleHostShareMounts =
      await this.collectStaleHostShareMounts(managedContainers);

    return {
      managed_container_count: managedContainers.length,
      orphaned_container_ids: orphanedContainerIds,
      stale_container_ids: staleContainerIds,
      stale_mount_directories: staleMountDirectories,
      stale_host_share_mounts: staleHostShareMounts,
    };
  }

  private collectActiveMountSources(
    containers: Array<{ Mounts?: Array<{ Source?: string }> }>,
  ): Set<string> {
    const mounts = new Set<string>();

    for (const container of containers) {
      for (const mount of container.Mounts ?? []) {
        if (typeof mount.Source !== 'string' || mount.Source.length === 0) {
          continue;
        }

        mounts.add(path.resolve(mount.Source));
      }
    }

    return mounts;
  }

  private async collectStaleMountDirectories(
    activeMountSources: Set<string>,
  ): Promise<string[]> {
    const rootDirectories = this.resolveMountRoots();
    const staleCutoffMs = Date.now() - MOUNT_STALE_HOURS * 60 * 60 * 1000;
    const staleDirectories: string[] = [];

    for (const rootDir of rootDirectories) {
      const directories = await this.safeListDirectories(rootDir);
      for (const directory of directories) {
        const resolved = path.resolve(directory);
        if (this.isDirectoryMounted(resolved, activeMountSources)) {
          continue;
        }

        const stats = await this.safeStat(resolved);
        if (!stats?.isDirectory()) {
          continue;
        }

        if (stats.mtimeMs < staleCutoffMs) {
          staleDirectories.push(resolved);
        }
      }
    }

    return staleDirectories;
  }

  private async collectStaleHostShareMounts(
    containers: Array<{
      Id: string;
      Names?: string[];
      Mounts?: Array<{ Source?: string; Destination?: string }>;
    }>,
  ): Promise<StaleHostShareMountDiagnostic[]> {
    const diagnostics: StaleHostShareMountDiagnostic[] = [];

    for (const container of containers) {
      const containerName = (container.Names?.[0] ?? '').replace(/^\//, '');

      for (const mount of container.Mounts ?? []) {
        const diagnostic = await this.inspectHostShareMount({
          containerId: container.Id,
          containerName,
          mount,
        });
        if (diagnostic) {
          diagnostics.push(diagnostic);
        }
      }
    }

    return diagnostics;
  }

  private isHostShareDestination(destinationPath: string): boolean {
    return (
      destinationPath === '/workspace/host-shares' ||
      destinationPath.startsWith('/workspace/host-shares/')
    );
  }

  private async inspectHostShareMount(params: {
    containerId: string;
    containerName: string;
    mount: { Source?: string; Destination?: string };
  }): Promise<StaleHostShareMountDiagnostic | null> {
    const destinationPath = path.posix.normalize(
      params.mount.Destination ?? '',
    );
    if (!this.isHostShareDestination(destinationPath)) {
      return null;
    }

    const sourcePath = params.mount.Source?.trim() ?? '';
    if (!sourcePath) {
      return this.createStaleHostShareDiagnostic({
        containerId: params.containerId,
        containerName: params.containerName,
        sourcePath: '',
        destinationPath,
        reason: 'missing_source',
      });
    }

    const stats = await this.safeStat(sourcePath);
    if (!stats) {
      return this.createStaleHostShareDiagnostic({
        containerId: params.containerId,
        containerName: params.containerName,
        sourcePath,
        destinationPath,
        reason: 'missing_source',
      });
    }

    if (!stats.isDirectory()) {
      return this.createStaleHostShareDiagnostic({
        containerId: params.containerId,
        containerName: params.containerName,
        sourcePath,
        destinationPath,
        reason: 'not_directory',
      });
    }

    return null;
  }

  private createStaleHostShareDiagnostic(params: {
    containerId: string;
    containerName: string;
    sourcePath: string;
    destinationPath: string;
    reason: 'missing_source' | 'not_directory';
  }): StaleHostShareMountDiagnostic {
    return {
      container_id: params.containerId,
      container_name: params.containerName,
      source_path: params.sourcePath,
      destination_path: params.destinationPath,
      reason: params.reason,
    };
  }

  private resolveMountRoots(): string[] {
    const roots = new Set<string>();
    roots.add(path.join(os.tmpdir(), 'nexus-tools'));

    const configuredToolMountRoot =
      process.env.NEXUS_HOST_TOOL_MOUNT_PATH?.trim();
    if (configuredToolMountRoot) {
      roots.add(configuredToolMountRoot);
    }

    return [...roots];
  }

  private async safeListDirectories(root: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name));

      const skillsDir = path.join(root, 'skills');
      if (directories.includes(skillsDir)) {
        const skillEntries = await fs.readdir(skillsDir, {
          withFileTypes: true,
        });
        for (const entry of skillEntries) {
          if (entry.isDirectory()) {
            directories.push(path.join(skillsDir, entry.name));
          }
        }
      }

      return directories;
    } catch {
      return [];
    }
  }

  private async safeStat(targetPath: string): Promise<{
    isDirectory(): boolean;
    mtimeMs: number;
  } | null> {
    try {
      return await fs.stat(targetPath);
    } catch {
      return null;
    }
  }

  private isDirectoryMounted(
    directoryPath: string,
    activeMountSources: Set<string>,
  ): boolean {
    for (const mountSource of activeMountSources) {
      if (
        mountSource === directoryPath ||
        mountSource.startsWith(`${directoryPath}${path.sep}`)
      ) {
        return true;
      }
    }

    return false;
  }

  async pruneArtifacts(artifacts: {
    container_ids: string[];
    mount_directories: string[];
    dry_run: boolean;
  }): Promise<{
    removed_containers: string[];
    removed_directories: string[];
    errors: string[];
  }> {
    const { removedIds: removedContainers, errors: containerErrors } =
      await this.pruneContainers(artifacts.container_ids, artifacts.dry_run);

    const { removedIds: removedDirectories, errors: directoryErrors } =
      await this.pruneDirectories(
        artifacts.mount_directories,
        artifacts.dry_run,
      );

    const errors = [...containerErrors, ...directoryErrors];

    if (errors.length > 0) {
      this.logger.warn(
        `Runtime artifact prune encountered ${errors.length.toString()} error(s)`,
      );
    }

    return {
      removed_containers: removedContainers,
      removed_directories: removedDirectories,
      errors,
    };
  }

  private async pruneContainers(
    containerIds: string[],
    dryRun: boolean,
  ): Promise<{ removedIds: string[]; errors: string[] }> {
    const removedContainers: string[] = [];
    const errors: string[] = [];

    for (const containerId of containerIds) {
      if (dryRun) {
        removedContainers.push(containerId);
        continue;
      }

      try {
        await this.docker.getContainer(containerId).remove({ force: true });
        removedContainers.push(containerId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`container ${containerId}: ${message}`);
      }
    }

    return {
      removedIds: removedContainers,
      errors,
    };
  }

  private async pruneDirectories(
    directories: string[],
    dryRun: boolean,
  ): Promise<{ removedIds: string[]; errors: string[] }> {
    const removedDirectories: string[] = [];
    const errors: string[] = [];

    for (const directory of directories) {
      if (dryRun) {
        removedDirectories.push(directory);
        continue;
      }

      try {
        await fs.rm(directory, { recursive: true, force: true });
        removedDirectories.push(directory);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`directory ${directory}: ${message}`);
      }
    }

    return {
      removedIds: removedDirectories,
      errors,
    };
  }
}
