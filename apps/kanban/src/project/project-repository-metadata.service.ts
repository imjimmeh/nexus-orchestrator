import { BadRequestException, Injectable } from "@nestjs/common";
import type { RepositoryFileContent } from "@nexus/core";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { ProjectService } from "./project.service";

@Injectable()
export class ProjectRepositoryMetadataService {
  constructor(
    private readonly projects: ProjectService,
    private readonly coreClient: CoreWorkflowClientService,
  ) {}

  async listBranches(projectId: string): Promise<string[]> {
    const repoPath = await this.getRepoPath(projectId);
    if (!repoPath) {
      return [];
    }
    const response = await this.coreClient.listRepositoryBranches({ repoPath });
    return this.normalizeSortedUnique(response.branches);
  }

  async listFiles(projectId: string): Promise<string[]> {
    const repoPath = await this.getRepoPath(projectId);
    if (!repoPath) {
      return [];
    }
    const response = await this.coreClient.listRepositoryTrackedFiles({
      repoPath,
    });
    return this.normalizeSortedUnique(response.files);
  }

  async getFileContent(
    projectId: string,
    filePath: string,
    branch?: string,
  ): Promise<RepositoryFileContent> {
    const repoPath = await this.getRepoPath(projectId);
    if (!repoPath) {
      throw new BadRequestException("Project has no repository path");
    }
    const ref = branch?.trim() || undefined;
    return this.coreClient.showRepositoryFile({ repoPath, filePath, ref });
  }

  private async getRepoPath(projectId: string): Promise<string | null> {
    const project = await this.projects.get(projectId);
    const repoPath = project.basePath?.trim();
    return repoPath && repoPath.length > 0 ? repoPath : null;
  }

  private normalizeSortedUnique(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim().replace(/\\/g, "/"))),
    )
      .filter((value) => value.length > 0)
      .sort((first, second) => first.localeCompare(second));
  }
}
