import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONTAINER_EXTENSIONS_PATH, type IHostMountBinding } from '@nexus/core';
import Docker from 'dockerode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  joinDockerHostPath,
  normalizePath,
  toRelativePath,
} from '../../docker/container-orchestrator.helpers';
import { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import { DOCKER_CLIENT } from '../../docker/docker.constants';

const CONTAINER_HOST_SHARE_ROOT = '/workspace/host-shares';
const HOST_MOUNT_SCOPE_MANIFEST = '_host_mount_scope.json';

interface ContainerInspectResult {
  Id?: string;
  Name?: string;
  Config?: {
    Labels?: Record<string, string>;
  };
  State?: {
    Status?: string;
  };
  Mounts?: Array<{
    Source?: string;
    Destination?: string;
  }>;
}

interface ContainerListResult {
  Id: string;
  Names?: string[];
  State?: string;
}

interface HostMountScopeLoadResult {
  manifestPath: string | null;
  bindings: IHostMountBinding[];
  error: string | null;
}

@Injectable()
export class WorkflowHostMountRuntimeDiagnosticsService {
  private readonly logger = new Logger(
    WorkflowHostMountRuntimeDiagnosticsService.name,
  );

  constructor(
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    private readonly containerOrchestrator: ContainerOrchestratorService,
  ) {}

  async getRunHostMountDiagnostics(
    workflowRunId: string,
  ): Promise<Record<string, unknown>> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: ['nexus.managed=true', `nexus.workflow_run_id=${workflowRunId}`],
      },
    });

    const diagnostics = await Promise.all(
      (containers as ContainerListResult[]).map((container) =>
        this.buildContainerDiagnostic(container),
      ),
    );

    return {
      workflowRunId,
      containerHostShareRoot: CONTAINER_HOST_SHARE_ROOT,
      containers: diagnostics,
    };
  }

  private async buildContainerDiagnostic(
    containerInfo: ContainerListResult,
  ): Promise<Record<string, unknown>> {
    const inspected = await this.inspectContainerSafely(containerInfo.Id);
    if (!inspected) {
      return this.buildInspectFailureDiagnostic(containerInfo);
    }

    return this.buildInspectedContainerDiagnostic(containerInfo, inspected);
  }

  private async buildInspectedContainerDiagnostic(
    containerInfo: ContainerListResult,
    inspected: ContainerInspectResult,
  ): Promise<Record<string, unknown>> {
    const labels = inspected.Config?.Labels ?? {};
    const attachedBindings =
      await this.containerOrchestrator.getContainerHostMountBindings(
        inspected.Id ?? containerInfo.Id,
      );

    const scopeManifest = this.loadScopeManifest(inspected);
    const bindingDrift = this.computeBindingDrift(
      attachedBindings,
      scopeManifest.bindings,
    );
    const missingHostPaths = this.findMissingHostPaths(attachedBindings);

    return {
      containerId: inspected.Id ?? containerInfo.Id,
      containerName: this.normalizeContainerName(inspected.Name),
      status: inspected.State?.Status ?? containerInfo.State ?? 'unknown',
      jobId: labels['nexus.job_id'] ?? null,
      stepId: labels['nexus.step_id'] ?? null,
      attachedBindings,
      scopeManifestBindings: scopeManifest.bindings,
      staleAttachedBindings: bindingDrift.staleAttachedBindings,
      staleManifestBindings: bindingDrift.staleManifestBindings,
      missingHostPaths,
      manifestPath: scopeManifest.manifestPath,
      manifestLoadError: scopeManifest.error,
    };
  }

  private inspectContainerSafely(
    containerId: string,
  ): Promise<ContainerInspectResult | null> {
    return this.docker
      .getContainer(containerId)
      .inspect()
      .then((result) => result as ContainerInspectResult)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to inspect container ${containerId}: ${message}`,
        );
        return null;
      });
  }

  private buildInspectFailureDiagnostic(
    containerInfo: ContainerListResult,
  ): Record<string, unknown> {
    return {
      containerId: containerInfo.Id,
      containerName: this.normalizeContainerName(containerInfo.Names?.[0]),
      status: containerInfo.State ?? 'unknown',
      jobId: null,
      stepId: null,
      attachedBindings: [],
      scopeManifestBindings: [],
      staleAttachedBindings: [],
      staleManifestBindings: [],
      missingHostPaths: [],
      manifestPath: null,
      manifestLoadError: 'Container inspect failed',
    };
  }

  private computeBindingDrift(
    attachedBindings: IHostMountBinding[],
    manifestBindings: IHostMountBinding[],
  ): {
    staleAttachedBindings: IHostMountBinding[];
    staleManifestBindings: IHostMountBinding[];
  } {
    const staleAttachedBindings = attachedBindings.filter(
      (attached) =>
        !manifestBindings.some((binding) =>
          this.matchesBinding(binding, attached),
        ),
    );
    const staleManifestBindings = manifestBindings.filter(
      (binding) =>
        !attachedBindings.some((attached) =>
          this.matchesBinding(binding, attached),
        ),
    );

    return {
      staleAttachedBindings,
      staleManifestBindings,
    };
  }

  private normalizeContainerName(name: string | undefined): string {
    return (name ?? '').replace(/^\//, '');
  }

  private loadScopeManifest(
    inspected: ContainerInspectResult,
  ): HostMountScopeLoadResult {
    const extensionMount = (inspected.Mounts ?? []).find(
      (mount) =>
        normalizePath(mount.Destination ?? '') === CONTAINER_EXTENSIONS_PATH,
    );

    if (!extensionMount?.Source) {
      return {
        manifestPath: null,
        bindings: [],
        error: 'No extensions mount attached',
      };
    }

    const readableMountPath = this.resolveReadableExtensionMountPath(
      extensionMount.Source,
    );
    const manifestPath = path.join(
      readableMountPath,
      HOST_MOUNT_SCOPE_MANIFEST,
    );

    if (!fs.existsSync(manifestPath)) {
      return {
        manifestPath,
        bindings: [],
        error: `${HOST_MOUNT_SCOPE_MANIFEST} not found`,
      };
    }

    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!Array.isArray(parsed)) {
        return {
          manifestPath,
          bindings: [],
          error: `${HOST_MOUNT_SCOPE_MANIFEST} must contain an array`,
        };
      }

      const bindings: IHostMountBinding[] = [];
      for (const entry of parsed) {
        const binding = this.parseBinding(entry);
        if (binding) {
          bindings.push(binding);
        }
      }

      return {
        manifestPath,
        bindings,
        error: null,
      };
    } catch (error) {
      return {
        manifestPath,
        bindings: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private resolveReadableExtensionMountPath(sourcePath: string): string {
    const hostToolMountPath = process.env.NEXUS_HOST_TOOL_MOUNT_PATH?.trim();
    if (!hostToolMountPath) {
      return sourcePath;
    }

    const toolMountBasePath =
      process.env.NEXUS_TOOL_MOUNT_BASE_PATH?.trim() ||
      path.join('/tmp', 'nexus-tools');
    const normalizedSource = normalizePath(sourcePath);
    const normalizedHostRoot = normalizePath(hostToolMountPath);
    const sourceComparable = normalizedSource.toLowerCase();
    const hostComparable = normalizedHostRoot.toLowerCase();

    if (
      sourceComparable !== hostComparable &&
      !sourceComparable.startsWith(`${hostComparable}/`)
    ) {
      return sourcePath;
    }

    const relativePath = toRelativePath(
      normalizedSource.slice(normalizedHostRoot.length),
    );
    return joinDockerHostPath(toolMountBasePath, relativePath);
  }

  private parseBinding(value: unknown): IHostMountBinding | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const alias = this.readString(record.alias);
    const hostPath = this.readString(record.hostPath);
    const containerPath = this.readString(record.containerPath);
    const mode = record.mode === 'rw' ? 'rw' : 'ro';
    const readOnly = record.readOnly === false ? false : mode !== 'rw';

    if (!alias || !hostPath || !containerPath) {
      return null;
    }

    return {
      alias,
      hostPath,
      containerPath,
      mode: readOnly ? 'ro' : 'rw',
      readOnly,
    };
  }

  private readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private matchesBinding(
    left: IHostMountBinding,
    right: IHostMountBinding,
  ): boolean {
    return (
      left.alias === right.alias &&
      normalizePath(left.hostPath) === normalizePath(right.hostPath) &&
      normalizePath(left.containerPath) ===
        normalizePath(right.containerPath) &&
      left.readOnly === right.readOnly
    );
  }

  private findMissingHostPaths(bindings: IHostMountBinding[]): string[] {
    const missing: string[] = [];

    for (const binding of bindings) {
      try {
        const stats = fs.statSync(binding.hostPath);
        if (!stats.isDirectory()) {
          missing.push(binding.hostPath);
        }
      } catch {
        missing.push(binding.hostPath);
      }
    }

    return [...new Set(missing.map((entry) => normalizePath(entry)))];
  }
}
