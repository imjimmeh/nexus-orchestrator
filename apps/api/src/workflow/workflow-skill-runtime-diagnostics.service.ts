import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IHostMountBinding } from '@nexus/core';
import Docker from 'dockerode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  joinDockerHostPath,
  normalizePath,
  toRelativePath,
} from '../docker/container-orchestrator.helpers';
import { ContainerOrchestratorService } from '../docker/container-orchestrator.service';
import { DOCKER_CLIENT } from '../docker/docker.constants';
import {
  CONTAINER_SKILLS_ROOT,
  SKILL_CATALOG_FILE_NAME,
} from '../tool-runtime/skill-mounting.constants';

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

interface SkillCatalogLoadResult {
  catalogPath: string;
  skillNames: string[];
  error: string | null;
}

interface RunSkillMountDiagnostic {
  containerId: string;
  containerName: string;
  status: string;
  jobId: string | null;
  stepId: string | null;
  hasSkillMount: boolean;
  authoringBindings: IHostMountBinding[];
  mountSourcePath: string | null;
  mountContainerPath: string | null;
  readableMountPath: string | null;
  skillCatalogPath: string | null;
  assignedSkillNames: string[];
  catalogLoadError: string | null;
}

interface RunSkillMountDiagnosticsResult {
  workflowRunId: string;
  containerSkillRoot: string;
  containers: RunSkillMountDiagnostic[];
}

interface RunSkillMountDiagnosticBase {
  containerId: string;
  containerName: string;
  status: string;
  jobId: string | null;
  stepId: string | null;
}

@Injectable()
export class WorkflowSkillRuntimeDiagnosticsService {
  private readonly logger = new Logger(
    WorkflowSkillRuntimeDiagnosticsService.name,
  );

  constructor(
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    private readonly containerOrchestrator: ContainerOrchestratorService,
  ) {}

  async getRunSkillMountDiagnostics(
    workflowRunId: string,
  ): Promise<RunSkillMountDiagnosticsResult> {
    const containers = await this.listRunContainers(workflowRunId);
    const diagnostics = await Promise.all(
      containers.map((container) => this.buildContainerDiagnostic(container)),
    );

    return {
      workflowRunId,
      containerSkillRoot: CONTAINER_SKILLS_ROOT,
      containers: diagnostics,
    };
  }

  private async listRunContainers(
    workflowRunId: string,
  ): Promise<ContainerListResult[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: ['nexus.managed=true', `nexus.workflow_run_id=${workflowRunId}`],
      },
    });

    return containers;
  }

  private async buildContainerDiagnostic(
    containerInfo: ContainerListResult,
  ): Promise<RunSkillMountDiagnostic> {
    const inspected = await this.inspectContainerSafely(containerInfo.Id);
    if (!inspected) {
      return this.buildInspectFailureDiagnostic(containerInfo);
    }

    return this.buildInspectedContainerDiagnostic(containerInfo, inspected);
  }

  private buildInspectFailureDiagnostic(
    containerInfo: ContainerListResult,
  ): RunSkillMountDiagnostic {
    return {
      containerId: containerInfo.Id,
      containerName: this.normalizeContainerName(containerInfo.Names?.[0]),
      status: containerInfo.State ?? 'unknown',
      jobId: null,
      stepId: null,
      hasSkillMount: false,
      authoringBindings: [],
      mountSourcePath: null,
      mountContainerPath: null,
      readableMountPath: null,
      skillCatalogPath: null,
      assignedSkillNames: [],
      catalogLoadError: 'Container inspect failed',
    };
  }

  private buildInspectedContainerDiagnostic(
    containerInfo: ContainerListResult,
    inspected: ContainerInspectResult,
  ): Promise<RunSkillMountDiagnostic> {
    const labels = inspected.Config?.Labels ?? {};
    const base = this.buildInspectedDiagnosticBase(
      containerInfo,
      inspected,
      labels,
    );
    const skillMount = this.findSkillMount(inspected);
    return this.buildSkillDiagnostic(
      base,
      skillMount,
      inspected.Id ?? containerInfo.Id,
    );
  }

  private async buildSkillDiagnostic(
    base: RunSkillMountDiagnosticBase,
    skillMount: {
      Source?: string;
      Destination?: string;
    } | null,
    containerId: string,
  ): Promise<RunSkillMountDiagnostic> {
    const authoringBindings = await this.resolveAuthoringBindings(containerId);

    if (!skillMount?.Source) {
      return this.buildMissingSkillMountDiagnostic(base, authoringBindings);
    }

    return this.buildMountedSkillDiagnostic(
      base,
      skillMount,
      authoringBindings,
    );
  }

  private buildInspectedDiagnosticBase(
    containerInfo: ContainerListResult,
    inspected: ContainerInspectResult,
    labels: Record<string, string>,
  ): RunSkillMountDiagnosticBase {
    return {
      containerId: inspected.Id ?? containerInfo.Id,
      containerName: this.normalizeContainerName(inspected.Name),
      status: inspected.State?.Status ?? containerInfo.State ?? 'unknown',
      jobId: labels['nexus.job_id'] ?? null,
      stepId: labels['nexus.step_id'] ?? null,
    };
  }

  private buildMissingSkillMountDiagnostic(
    base: RunSkillMountDiagnosticBase,
    authoringBindings: IHostMountBinding[],
  ): RunSkillMountDiagnostic {
    return {
      ...base,
      hasSkillMount: false,
      authoringBindings,
      mountSourcePath: null,
      mountContainerPath: CONTAINER_SKILLS_ROOT,
      readableMountPath: null,
      skillCatalogPath: null,
      assignedSkillNames: [],
      catalogLoadError: 'No skill mount attached',
    };
  }

  private buildMountedSkillDiagnostic(
    base: RunSkillMountDiagnosticBase,
    skillMount: {
      Source?: string;
      Destination?: string;
    },
    authoringBindings: IHostMountBinding[],
  ): RunSkillMountDiagnostic {
    const readableMountPath = this.resolveReadableSkillMountPath(
      skillMount.Source ?? '',
    );
    const catalog = this.loadSkillCatalog(readableMountPath);

    return {
      ...base,
      hasSkillMount: true,
      authoringBindings,
      mountSourcePath: skillMount.Source ?? null,
      mountContainerPath: skillMount.Destination ?? CONTAINER_SKILLS_ROOT,
      readableMountPath,
      skillCatalogPath: catalog.catalogPath,
      assignedSkillNames: catalog.skillNames,
      catalogLoadError: catalog.error,
    };
  }

  private findSkillMount(inspected: ContainerInspectResult): {
    Source?: string;
    Destination?: string;
  } | null {
    const mounts = inspected.Mounts ?? [];
    const skillMount = mounts.find((mount) => {
      const dest = normalizePath(mount.Destination ?? '');
      return (
        dest === CONTAINER_SKILLS_ROOT ||
        dest === '/root/.claude/skills' ||
        dest.endsWith('/skills')
      );
    });
    return skillMount ?? null;
  }

  private normalizeContainerName(name: string | undefined): string {
    return (name ?? '').replace(/^\//, '');
  }

  private async inspectContainerSafely(
    containerId: string,
  ): Promise<ContainerInspectResult | null> {
    try {
      const container = this.docker.getContainer(containerId);
      return await container.inspect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to inspect container ${containerId}: ${message}`,
      );
      return null;
    }
  }

  private async resolveAuthoringBindings(
    containerId: string,
  ): Promise<IHostMountBinding[]> {
    try {
      const bindings =
        await this.containerOrchestrator.getContainerHostMountBindings(
          containerId,
        );

      return bindings.filter((binding) => binding.alias === 'skills_library');
    } catch {
      return [];
    }
  }

  private resolveReadableSkillMountPath(sourcePath: string): string {
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

  private loadSkillCatalog(readableMountPath: string): SkillCatalogLoadResult {
    const catalogPath = path.join(readableMountPath, SKILL_CATALOG_FILE_NAME);
    if (!fs.existsSync(catalogPath)) {
      return {
        catalogPath,
        skillNames: [],
        error: `${SKILL_CATALOG_FILE_NAME} not found`,
      };
    }

    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      if (!Array.isArray(parsed)) {
        return {
          catalogPath,
          skillNames: [],
          error: `${SKILL_CATALOG_FILE_NAME} must contain an array`,
        };
      }

      const names = parsed
        .map((entry) => {
          if (typeof entry !== 'object' || entry === null) {
            return null;
          }

          const name = (entry as { name?: unknown }).name;
          return typeof name === 'string' && name.trim().length > 0
            ? name
            : null;
        })
        .filter((name): name is string => Boolean(name));

      return {
        catalogPath,
        skillNames: [...new Set(names)],
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        catalogPath,
        skillNames: [],
        error: message,
      };
    }
  }
}
