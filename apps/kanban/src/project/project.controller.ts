import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import type {
  CreateProjectInput,
  UpdateProjectRequest,
} from "@nexus/kanban-contracts";
import {
  PROJECT_MEMORY_CATEGORIES,
  ProjectMemoryCategorySchema,
} from "@nexus/kanban-contracts";
import { load as loadYaml } from "js-yaml";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { CharterAggregateService } from "./charter-aggregate.service";
import { ProjectAgentsFileService } from "./project-agents-file.service";
import type { UpdateProjectAgentsDocumentInput } from "./project-agents-file.service.types";
import { ProjectMemorySummaryService } from "./project-memory-summary.service";
import { ProjectRepositoryMetadataService } from "./project-repository-metadata.service";
import { ProjectService } from "./project.service";

@Controller("projects")
export class ProjectController {
  constructor(
    private readonly projects: ProjectService,
    private readonly coreClient: CoreWorkflowClientService,
    private readonly projectMemorySummary: ProjectMemorySummaryService,
    private readonly repositoryMetadata: ProjectRepositoryMetadataService,
    private readonly agentsFile: ProjectAgentsFileService,
    private readonly charterAggregate: CharterAggregateService,
  ) {}

  @Post()
  async create(@Body() body: CreateProjectInput) {
    const data = await this.projects.create(body);
    return { success: true, data };
  }

  @Post(":project_id/charter/launch")
  async launchCharterOnboarding(
    @Param("project_id") project_id: string,
    @Body() body: { mode?: string },
  ) {
    const mode =
      body.mode === "brownfield" || body.mode === "refine"
        ? body.mode
        : "greenfield";
    const data = await this.projects.launchCharterOnboarding(project_id, mode);
    return { success: true, data };
  }

  @Get(":project_id/charter")
  async getCharter(@Param("project_id") project_id: string) {
    const data = await this.charterAggregate.getCharter(project_id);
    return { success: true, data };
  }

  @Get()
  async list() {
    const data = await this.projects.list();
    return { success: true, data };
  }

  @Get(":project_id")
  async get(@Param("project_id") project_id: string) {
    const data = await this.projects.get(project_id);
    return { success: true, data };
  }

  @Patch(":project_id")
  async update(
    @Param("project_id") project_id: string,
    @Body() body: UpdateProjectRequest,
  ) {
    const data = await this.projects.update(project_id, body);
    return { success: true, data };
  }

  @Delete(":project_id")
  async delete(@Param("project_id") project_id: string) {
    await this.projects.delete(project_id);
    return { success: true };
  }

  @Post(":project_id/orchestration/reset-intents")
  async resetBlockedIntents(@Param("project_id") project_id: string) {
    const data = await this.projects.resetBlockedIntents(project_id);
    return { success: true, data };
  }

  @Post(":project_id/orchestration/leases/release-all")
  async releaseAllLeases(@Param("project_id") project_id: string) {
    const data = await this.projects.resetBlockedIntents(project_id);
    return { success: true, data };
  }

  @Get(":project_id/repository-workflows/settings")
  async getRepositoryWorkflowSettings(@Param("project_id") project_id: string) {
    const data = await this.projects.getRepositoryWorkflowSettings(project_id);
    return { success: true, data };
  }

  @Patch(":project_id/repository-workflows/settings")
  async updateRepositoryWorkflowSettings(
    @Param("project_id") project_id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const data = await this.projects.updateRepositoryWorkflowSettings(
      project_id,
      body,
    );
    return { success: true, data };
  }

  @Get(":project_id/orchestration/settings")
  async getOrchestrationSettings(@Param("project_id") project_id: string) {
    const data = await this.projects.getOrchestrationSettings(project_id);
    return { success: true, data };
  }

  @Patch(":project_id/orchestration/settings")
  async updateOrchestrationSettings(
    @Param("project_id") project_id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const data = await this.projects.updateOrchestrationSettings(
      project_id,
      body,
    );
    return { success: true, data };
  }

  @Get(":project_id/repository/branches")
  async listRepositoryBranches(@Param("project_id") project_id: string) {
    const data = await this.repositoryMetadata.listBranches(project_id);
    return { success: true, data };
  }

  @Get(":project_id/repository/files")
  async listRepositoryFiles(@Param("project_id") project_id: string) {
    const data = await this.repositoryMetadata.listFiles(project_id);
    return { success: true, data };
  }

  @Get(":project_id/repository/files/content")
  async getRepositoryFileContent(
    @Param("project_id") project_id: string,
    @Query("path") filePath?: string,
    @Query("branch") branch?: string,
  ) {
    const normalizedFilePath = filePath?.trim();
    if (!normalizedFilePath) {
      throw new BadRequestException("path query parameter is required");
    }
    const data = await this.repositoryMetadata.getFileContent(
      project_id,
      normalizedFilePath,
      branch,
    );
    return { success: true, data };
  }

  @Get(":project_id/repository/agents-file")
  async getProjectAgentsFile(@Param("project_id") project_id: string) {
    const data = await this.agentsFile.getDocument(project_id);
    return { success: true, data };
  }

  @Put(":project_id/repository/agents-file")
  async updateProjectAgentsFile(
    @Param("project_id") project_id: string,
    @Body() body: UpdateProjectAgentsDocumentInput,
  ) {
    const data = await this.agentsFile.updateDocument(project_id, body);
    return { success: true, data };
  }

  @Get(":project_id/workflow-files")
  async listWorkflowFiles(@Param("project_id") project_id: string) {
    const project = await this.projects.get(project_id);
    if (!project.basePath) {
      return { files: [], error: "Project has no repository path" };
    }
    const basePath = project.basePath;
    const result = await this.coreClient.listRepoFiles({
      repoPath: basePath,
      directory: ".nexus/workflows",
      pattern: ".workflow.yaml",
    });
    const enriched = await Promise.all(
      result.files.map(async (file) => ({
        ...file,
        trigger: await this.extractWorkflowTrigger(basePath, file.path),
      })),
    );
    return { ...result, files: enriched };
  }

  @Get(":project_id/workflow-files/:filename/content")
  async readWorkflowFile(
    @Param("project_id") project_id: string,
    @Param("filename") filename: string,
  ) {
    const project = await this.projects.get(project_id);
    if (!project.basePath) {
      throw new NotFoundException("Project has no repository path");
    }
    const filePath = `.nexus/workflows/${filename}`;
    return this.coreClient.readRepoFile({
      repoPath: project.basePath,
      filePath,
    });
  }

  @Put(":project_id/workflow-files/:filename")
  async writeWorkflowFile(
    @Param("project_id") project_id: string,
    @Param("filename") filename: string,
    @Body() body: { content: string; message?: string },
  ) {
    const project = await this.projects.get(project_id);
    if (!project.basePath) {
      throw new NotFoundException("Project has no repository path");
    }
    const filePath = `.nexus/workflows/${filename}`;
    return this.coreClient.writeRepoFile({
      repoPath: project.basePath,
      filePath,
      content: body.content,
      message: body.message ?? `docs(workflows): update ${filename}`,
    });
  }

  @Delete(":project_id/workflow-files/:filename")
  async deleteWorkflowFile(
    @Param("project_id") project_id: string,
    @Param("filename") filename: string,
    @Query("message") message?: string,
  ) {
    const project = await this.projects.get(project_id);
    if (!project.basePath) {
      throw new NotFoundException("Project has no repository path");
    }
    const filePath = `.nexus/workflows/${filename}`;
    return this.coreClient.deleteRepoFile({
      repoPath: project.basePath,
      filePath,
      message: message ?? `docs(workflows): delete ${filename}`,
    });
  }

  @Get(":project_id/memory/segments")
  async getMemorySegments(
    @Param("project_id") project_id: string,
    @Query()
    query: {
      limit?: string;
      offset?: string;
      memory_type?: string;
      query?: string;
    },
  ) {
    const data = await this.projectMemorySummary.getProjectMemorySegments(
      project_id,
      {
        limit: query.limit ? Number(query.limit) : 25,
        offset: query.offset ? Number(query.offset) : 0,
        memory_type: query.memory_type,
        query: query.query,
      },
    );
    return { success: true, data };
  }

  @Get(":project_id/charter-memories")
  async getCharterMemories(@Param("project_id") project_id: string) {
    const rows = await this.projectMemorySummary.getCharterMemories(project_id);
    const grouped: Partial<Record<string, typeof rows>> = {};
    for (const row of rows) {
      const category = (row.metadata as { category?: string }).category;
      if (category) {
        grouped[category] ??= [];
        grouped[category].push(row);
      }
    }
    return { success: true, data: grouped };
  }

  @Post(":project_id/charter-memories")
  async createCharterMemory(
    @Param("project_id") project_id: string,
    @Body() body: { category: string; content: string },
  ) {
    const parsed = ProjectMemoryCategorySchema.safeParse(body.category);
    if (!parsed.success) {
      throw new BadRequestException(
        `Unknown category "${body.category}". Must be one of: ${PROJECT_MEMORY_CATEGORIES.join(", ")}.`,
      );
    }
    const memoryType = parsed.data === "preference" ? "preference" : "fact";
    const data = await this.projectMemorySummary.createCharterMemory(
      project_id,
      parsed.data,
      body.content,
      memoryType,
    );
    return { success: true, data };
  }

  @Patch(":project_id/charter-memories/:memory_id")
  async updateCharterMemory(
    @Param("project_id") project_id: string,
    @Param("memory_id") memory_id: string,
    @Body() body: { content: string },
  ) {
    const data = await this.projectMemorySummary.updateCharterMemory(
      memory_id,
      project_id,
      body.content,
    );
    if (!data)
      throw new NotFoundException(`Charter memory ${memory_id} not found`);
    return { success: true, data };
  }

  @Delete(":project_id/charter-memories/:memory_id")
  async deleteCharterMemory(
    @Param("project_id") project_id: string,
    @Param("memory_id") memory_id: string,
  ) {
    const deleted = await this.projectMemorySummary.deleteCharterMemory(
      memory_id,
      project_id,
    );
    if (!deleted)
      throw new NotFoundException(`Charter memory ${memory_id} not found`);
    return { success: true };
  }

  private async extractWorkflowTrigger(
    repoPath: string,
    filePath: string,
  ): Promise<{
    phase: string;
    hook: "before" | "after";
    blocking: boolean;
  } | null> {
    try {
      const { content } = await this.coreClient.readRepoFile({
        repoPath,
        filePath,
      });
      const doc = loadYaml(content) as Record<string, unknown> | null;
      if (!doc || typeof doc !== "object") return null;
      const trigger = doc["trigger"] as Record<string, unknown> | undefined;
      if (!trigger || trigger["type"] !== "lifecycle") return null;
      const phase =
        typeof trigger["phase"] === "string" && trigger["phase"].length > 0
          ? trigger["phase"]
          : null;
      const hook =
        trigger["hook"] === "before" || trigger["hook"] === "after"
          ? trigger["hook"]
          : null;
      if (!phase || !hook) return null;
      // Before-hooks block transitions by convention when the field is omitted
      const blocking =
        typeof trigger["blocking"] === "boolean"
          ? trigger["blocking"]
          : hook === "before";
      return { phase, hook, blocking };
    } catch {
      return null;
    }
  }
}
