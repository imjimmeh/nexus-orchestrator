import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { ProjectRepositoryMetadataService } from "./project-repository-metadata.service";
import type { ProjectService } from "./project.service";
import type { ProjectRecord } from "./project.types";

describe("ProjectRepositoryMetadataService", () => {
  const project = {
    id: "project-1",
    name: "Repository project",
    goals: null,
    repositoryUrl: null,
    basePath: "G:\\workspace\\repo",
    githubSecretId: null,
    description: null,
    sourceType: null,
    copyToWorkspace: null,
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  } satisfies ProjectRecord;

  const projects = {
    get: vi.fn(),
  };

  const coreClient = {
    listRepositoryBranches: vi.fn(),
    listRepositoryTrackedFiles: vi.fn(),
    showRepositoryFile: vi.fn(),
  };

  const service = new ProjectRepositoryMetadataService(
    projects as unknown as ProjectService,
    coreClient as unknown as CoreWorkflowClientService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("lists sorted repository branches for a project base path", async () => {
    projects.get.mockResolvedValue(project);
    coreClient.listRepositoryBranches.mockResolvedValue({
      branches: ["main", "feature/a", "main"],
    });

    const result = await service.listBranches("project-1");

    expect(projects.get).toHaveBeenCalledWith("project-1");
    expect(coreClient.listRepositoryBranches).toHaveBeenCalledWith({
      repoPath: "G:\\workspace\\repo",
    });
    expect(result).toEqual(["feature/a", "main"]);
  });

  it("lists sorted repository files for a project base path", async () => {
    projects.get.mockResolvedValue(project);
    coreClient.listRepositoryTrackedFiles.mockResolvedValue({
      files: ["src\\index.ts", "README.md"],
    });

    const result = await service.listFiles("project-1");

    expect(coreClient.listRepositoryTrackedFiles).toHaveBeenCalledWith({
      repoPath: "G:\\workspace\\repo",
    });
    expect(result).toEqual(["README.md", "src/index.ts"]);
  });

  it("reads repository file content for a project base path", async () => {
    const fileContent = {
      content: "# Repository\n",
      path: "README.md",
      branch: "main",
      size: 13,
    };
    projects.get.mockResolvedValue(project);
    coreClient.showRepositoryFile.mockResolvedValue(fileContent);

    const result = await service.getFileContent(
      "project-1",
      "README.md",
      "main",
    );

    expect(coreClient.showRepositoryFile).toHaveBeenCalledWith({
      repoPath: "G:\\workspace\\repo",
      filePath: "README.md",
      ref: "main",
    });
    expect(result).toEqual(fileContent);
  });

  it("returns empty lists when the project has no base path", async () => {
    projects.get.mockResolvedValue({ ...project, basePath: null });

    await expect(service.listBranches("project-1")).resolves.toEqual([]);
    await expect(service.listFiles("project-1")).resolves.toEqual([]);
    expect(coreClient.listRepositoryBranches).not.toHaveBeenCalled();
    expect(coreClient.listRepositoryTrackedFiles).not.toHaveBeenCalled();
  });

  it("rejects file content reads when the project has no base path", async () => {
    projects.get.mockResolvedValue({ ...project, basePath: null });

    await expect(
      service.getFileContent("project-1", "README.md", "main"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(coreClient.showRepositoryFile).not.toHaveBeenCalled();
  });
});
