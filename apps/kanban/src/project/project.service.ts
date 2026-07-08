import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { CoreScopeClientService } from "../core/core-scope-client.service";
import type { KanbanProjectEntity } from "../database/entities/kanban-project.entity";
import { KanbanCoreRunProjectionRepository } from "../database/repositories/kanban-core-run-projection.repository";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import { KanbanProjectGoalRepository } from "../database/repositories/kanban-project-goal.repository";
import { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import {
  assertRepositoryUrlIsSafeRemote,
  ManagedProjectCloneService,
} from "./managed-project-clone.service";
import { OrchestrationLeaseService } from "../orchestration/control-plane/orchestration-lease.service";
import { toCreateEntity } from "../work-item/work-item.factory";
import type {
  CreateProjectInput,
  IngestionInputs,
  ProjectGoalInput,
  ProjectRecord,
  UpdateProjectRequest,
} from "./project.types";
import {
  resolveRepositoryWorkflowSettings,
  type RepositoryWorkflowSettings,
  resolveProjectOrchestrationSettings,
  type ProjectOrchestrationSettings,
  ProjectOrchestrationSettingsSchema,
} from "@nexus/kanban-contracts";

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly projects: KanbanProjectRepository,
    private readonly goals: KanbanProjectGoalRepository,
    private readonly workItems: KanbanWorkItemRepository,
    private readonly orchestrations: KanbanOrchestrationRepository,
    private readonly coreProjections: KanbanCoreRunProjectionRepository,
    private readonly coreWorkflowClient: CoreWorkflowClientService,
    private readonly managedClones: ManagedProjectCloneService,
    private readonly coreScopeClient: CoreScopeClientService,
    private readonly leaseService: OrchestrationLeaseService,
  ) {}

  async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const goals = this.normalizeGoals(input.goals);
    const shouldStartManagedClone = this.shouldStartManagedClone(input);
    this.validateRepositoryUrl(input.repositoryUrl);

    const project = await this.projects.save({
      id: randomUUID(),
      name: input.name,
      goals: null,
      description: input.description ?? null,
      source_type: input.sourceType ?? null,
      repository_url: input.repositoryUrl ?? null,
      base_path: input.basePath ?? null,
      github_secret_id: input.githubSecretId ?? null,
      copy_to_workspace: input.copyToWorkspace ?? null,
    });

    await this.registerScopeNode(project.id, project.name);

    await Promise.all(goals.map((goal) => this.goals.create(project.id, goal)));

    if (shouldStartManagedClone) {
      this.managedClones.startClone(project.id);
    }

    if (input.ingestionInputs) {
      await this.triggerIngestionWorkflow(
        project.id,
        input.name,
        input.ingestionInputs,
      );
    }

    let onboardingRunId: string | undefined;
    if (input.startOnboarding) {
      // An imported repository is a brownfield project: route onboarding so the
      // CEO agent runs codebase discovery before eliciting charter intent.
      const onboardingMode = input.ingestionInputs
        ? "brownfield"
        : "greenfield";
      onboardingRunId = await this.triggerOnboardingWorkflow(
        project.id,
        onboardingMode,
      );
    }

    const record = this.toRecord(project);
    return onboardingRunId ? { ...record, onboardingRunId } : record;
  }

  private async registerScopeNode(
    projectId: string,
    projectName: string,
  ): Promise<void> {
    try {
      await this.coreScopeClient.ensureProjectNode({
        id: projectId,
        parentId: null,
        type: "project",
        name: projectName,
        slug: projectId,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to register scope node for project ${projectId}: ${(error as Error).message}`,
      );
    }
  }

  private async triggerIngestionWorkflow(
    projectId: string,
    projectName: string,
    ingestionInputs: IngestionInputs,
  ): Promise<void> {
    const workItemId = randomUUID();

    await this.workItems.save(
      toCreateEntity({
        id: workItemId,
        project_id: projectId,
        title: `Design Ingestion: ${projectName}`,
        description: null,
        status: "backlog",
        priority: "p1",
        type: "epic",
        execution_config: null,
        metadata: { type: "ingestion", source: "project_creation" },
      }),
    );

    await this.coreWorkflowClient.requestWorkflowRun({
      workflow_id: "design_ingestion_new_project",
      input: {
        projectName,
        workItemId,
        files: ingestionInputs.files ?? [],
        urls: ingestionInputs.urls ?? [],
      },
      launch_source: "project_creation",
      context: {
        scopeId: projectId,
        contextId: workItemId,
        contextType: "work_item",
        metadata: null,
        scopeNodeId: null,
        scopePath: null,
      },
      metadata: {
        correlation_id: randomUUID(),
        requested_by: "kanban",
      },
    });
  }

  private async triggerOnboardingWorkflow(
    projectId: string,
    mode: "greenfield" | "brownfield" | "refine",
  ): Promise<string> {
    const runResult = await this.coreWorkflowClient.requestWorkflowRun({
      workflow_id: "project_charter_ceo",
      input: { mode },
      launch_source: "project_creation",
      context: {
        scopeId: projectId,
        contextId: projectId,
        contextType: "project",
        metadata: null,
        scopeNodeId: null,
        scopePath: null,
      },
      metadata: {
        correlation_id: randomUUID(),
        requested_by: "kanban",
      },
    });
    return runResult.run_id ?? "";
  }

  async launchCharterOnboarding(
    projectId: string,
    mode: "greenfield" | "brownfield" | "refine",
  ): Promise<{ onboardingRunId: string }> {
    const project = await this.projects.findById(projectId);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    const onboardingRunId = await this.triggerOnboardingWorkflow(
      projectId,
      mode,
    );
    return { onboardingRunId };
  }

  private shouldStartManagedClone(input: CreateProjectInput): boolean {
    return (
      input.sourceType === "import_remote" &&
      !!input.repositoryUrl?.trim() &&
      !input.basePath?.trim()
    );
  }

  private validateRepositoryUrl(repositoryUrl: string | undefined): void {
    const trimmedRepositoryUrl = repositoryUrl?.trim();
    if (!trimmedRepositoryUrl) {
      return;
    }

    assertRepositoryUrlIsSafeRemote(trimmedRepositoryUrl);
  }

  async list(): Promise<ProjectRecord[]> {
    const projects = await this.projects.findAll();
    return projects.map((project) => this.toRecord(project));
  }

  async get(project_id: string): Promise<ProjectRecord> {
    const project = await this.projects.findById(project_id);
    if (!project) {
      throw new NotFoundException(`Project ${project_id} not found`);
    }

    return this.toRecord(project);
  }

  async update(
    project_id: string,
    input: UpdateProjectRequest,
  ): Promise<ProjectRecord> {
    const project = await this.projects.findById(project_id);
    if (!project) {
      throw new NotFoundException(`Project ${project_id} not found`);
    }

    this.validateRepositoryUrl(input.repositoryUrl);

    const updated = await this.projects.save({
      id: project.id,
      name: input.name?.trim() || project.name,
      goals: project.goals,
      description: this.resolveOptionalText(
        input.description,
        project.description,
      ),
      repository_url: this.resolveOptionalText(
        input.repositoryUrl,
        project.repository_url,
      ),
      base_path: this.resolveOptionalText(input.basePath, project.base_path),
      github_secret_id: this.resolveOptionalText(
        input.githubSecretId,
        project.github_secret_id,
      ),
      source_type: project.source_type,
      copy_to_workspace: project.copy_to_workspace,
      repository_workflow_settings: project.repository_workflow_settings,
      runtime_toolchains:
        input.runtime_toolchains !== undefined
          ? input.runtime_toolchains
          : project.runtime_toolchains,
      created_at: project.created_at,
      updated_at: project.updated_at,
    });

    return this.toRecord(updated);
  }

  async resetBlockedIntents(project_id: string): Promise<{ count: number }> {
    const project = await this.projects.findById(project_id);
    if (!project) {
      throw new NotFoundException(`Project ${project_id} not found`);
    }

    const count = await this.leaseService.releaseAllForProject(project_id);
    return { count };
  }

  async delete(project_id: string): Promise<void> {
    const project = await this.projects.findById(project_id);
    if (!project) {
      throw new NotFoundException(`Project ${project_id} not found`);
    }

    await this.cancelProjectWorkflowRuns(project.id);

    await Promise.all([
      this.workItems.deleteByproject_id(project_id),
      this.orchestrations.deleteByproject_id(project_id),
      this.goals.deleteByproject_id(project_id),
      this.coreProjections.deleteByproject_id(project_id),
      this.projects.removeById(project_id),
    ]);
  }

  private async cancelProjectWorkflowRuns(project_id: string): Promise<void> {
    try {
      await this.coreWorkflowClient.cancelWorkflowRunsByScope(project_id, {
        reason: "project_deleted",
        metadata: {
          correlation_id: randomUUID(),
          requested_by: "kanban",
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to cancel active workflow runs for deleted project ${project_id}: ${
          (error as Error).message
        }`,
      );
    }
  }

  private toRecord(
    project: Pick<
      KanbanProjectEntity,
      | "id"
      | "name"
      | "goals"
      | "repository_url"
      | "base_path"
      | "github_secret_id"
      | "description"
      | "source_type"
      | "copy_to_workspace"
      | "orchestration_settings"
      | "runtime_toolchains"
      | "created_at"
      | "updated_at"
    >,
  ): ProjectRecord {
    return {
      id: project.id,
      name: project.name,
      goals: project.goals,
      repositoryUrl: project.repository_url,
      basePath: project.base_path,
      githubSecretId: project.github_secret_id,
      description: project.description,
      sourceType: this.toProjectSourceType(project.source_type),
      copyToWorkspace: project.copy_to_workspace,
      orchestrationSettings: project.orchestration_settings ?? null,
      runtime_toolchains: project.runtime_toolchains ?? null,
      createdAt: project.created_at.toISOString(),
      updatedAt: project.updated_at.toISOString(),
    };
  }

  private resolveOptionalText(
    nextValue: string | undefined,
    currentValue: string | null,
  ): string | null {
    if (nextValue === undefined) {
      return currentValue;
    }

    const trimmed = nextValue.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toProjectSourceType(
    sourceType: string | null,
  ): ProjectRecord["sourceType"] {
    if (
      sourceType === "create_new" ||
      sourceType === "import_local" ||
      sourceType === "import_remote"
    ) {
      return sourceType;
    }

    return null;
  }

  private normalizeGoals(
    goals: ProjectGoalInput[] | undefined,
  ): ProjectGoalInput[] {
    if (!goals || goals.length === 0) {
      return [];
    }

    const normalized: ProjectGoalInput[] = [];
    for (const goal of goals) {
      const entry = this.normalizeGoal(goal);
      if (entry) {
        normalized.push(entry);
      }
    }
    return normalized;
  }

  private normalizeGoal(goal: ProjectGoalInput): ProjectGoalInput | null {
    const title = goal.title.trim();
    if (title.length === 0) {
      return null;
    }
    const entry: ProjectGoalInput = { title };
    const description = goal.description?.trim();
    if (description) entry.description = description;
    const moscow = goal.moscow?.trim();
    if (moscow) entry.moscow = moscow;
    const priority = goal.priority?.trim();
    if (priority) entry.priority = priority;
    const targetDate = goal.target_date?.trim();
    if (targetDate) entry.target_date = targetDate;
    return entry;
  }

  async getRepositoryWorkflowSettings(
    project_id: string,
  ): Promise<RepositoryWorkflowSettings> {
    const project = await this.projects.findById(project_id);
    if (!project)
      throw new NotFoundException(`Project ${project_id} not found`);
    return resolveRepositoryWorkflowSettings(
      project.repository_workflow_settings,
    );
  }

  async updateRepositoryWorkflowSettings(
    project_id: string,
    settings: Partial<RepositoryWorkflowSettings>,
  ): Promise<RepositoryWorkflowSettings> {
    const project = await this.projects.findById(project_id);
    if (!project)
      throw new NotFoundException(`Project ${project_id} not found`);
    const current = resolveRepositoryWorkflowSettings(
      project.repository_workflow_settings,
    );
    const merged: RepositoryWorkflowSettings = {
      enabled: settings.enabled ?? current.enabled,
      overrides: { ...current.overrides, ...settings.overrides },
    };
    const repositoryWorkflowSettings: Record<string, unknown> = {
      enabled: merged.enabled,
      overrides: merged.overrides,
    };
    project.repository_workflow_settings = repositoryWorkflowSettings;
    await this.projects.save(project);
    return merged;
  }

  async getOrchestrationSettings(
    project_id: string,
  ): Promise<ProjectOrchestrationSettings> {
    const project = await this.projects.findById(project_id);
    if (!project)
      throw new NotFoundException(`Project ${project_id} not found`);
    return resolveProjectOrchestrationSettings(project.orchestration_settings);
  }

  async updateOrchestrationSettings(
    project_id: string,
    settings: Partial<ProjectOrchestrationSettings>,
  ): Promise<ProjectOrchestrationSettings> {
    const project = await this.projects.findById(project_id);
    if (!project)
      throw new NotFoundException(`Project ${project_id} not found`);

    const parsed = ProjectOrchestrationSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid orchestration settings: ${parsed.error.message}`,
      );
    }

    const current = resolveProjectOrchestrationSettings(
      project.orchestration_settings,
    );
    const merged: ProjectOrchestrationSettings = {
      ...current,
      ...(parsed.data.wakePolicy !== undefined
        ? { wakePolicy: parsed.data.wakePolicy }
        : {}),
    };
    project.orchestration_settings = merged;
    await this.projects.save(project);
    return merged;
  }
}
