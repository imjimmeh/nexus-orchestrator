import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectAgentsFileService } from "./project-agents-file.service";
import type { ProjectService } from "./project.service";
import type { ProjectRecord } from "./project.types";

describe("ProjectAgentsFileService", () => {
  let repoPath: string;

  const projects = {
    get: vi.fn(),
  };

  const createProject = (basePath: string | null): ProjectRecord => ({
    id: "project-1",
    name: "Repository project",
    goals: null,
    repositoryUrl: null,
    basePath,
    githubSecretId: null,
    description: null,
    sourceType: null,
    copyToWorkspace: null,
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
  });

  const service = new ProjectAgentsFileService(
    projects as unknown as ProjectService,
  );

  beforeEach(async () => {
    vi.resetAllMocks();
    repoPath = await mkdtemp(join(tmpdir(), "nexus-agents-file-"));
    projects.get.mockResolvedValue(createProject(repoPath));
  });

  afterEach(async () => {
    await rm(repoPath, { force: true, recursive: true });
  });

  it("returns existing AGENTS.md content with an etag", async () => {
    const content = "# Agent instructions\n";
    await writeFile(join(repoPath, "AGENTS.md"), content, "utf8");

    const document = await service.getDocument("project-1");

    expect(projects.get).toHaveBeenCalledWith("project-1");
    expect(document).toEqual({
      projectId: "project-1",
      path: "AGENTS.md",
      exists: true,
      content,
      etag: createHash("sha256").update(content, "utf8").digest("hex"),
      updatedAt: expect.any(String),
    });
  });

  it("returns a missing document when AGENTS.md does not exist", async () => {
    const document = await service.getDocument("project-1");

    expect(document).toEqual({
      projectId: "project-1",
      path: "AGENTS.md",
      exists: false,
      content: "",
      etag: null,
      updatedAt: null,
    });
  });

  it("writes a new AGENTS.md document when no etag exists", async () => {
    const document = await service.updateDocument("project-1", {
      content: "# New instructions\n",
      expected_etag: null,
    });

    expect(document.exists).toBe(true);
    expect(document.content).toBe("# New instructions\n");
    expect(document.etag).toBe(
      createHash("sha256").update("# New instructions\n", "utf8").digest("hex"),
    );
  });

  it("requires matching etag when AGENTS.md already exists", async () => {
    await writeFile(join(repoPath, "AGENTS.md"), "# Existing\n", "utf8");

    await expect(
      service.updateDocument("project-1", {
        content: "# Updated\n",
        expected_etag: "wrong-etag",
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const current = await service.getDocument("project-1");
    const updated = await service.updateDocument("project-1", {
      content: "# Updated\n",
      expected_etag: current.etag,
    });

    expect(updated.content).toBe("# Updated\n");
  });

  it("rejects missing base paths and invalid content", async () => {
    projects.get.mockResolvedValue(createProject(null));

    await expect(service.getDocument("project-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );

    projects.get.mockResolvedValue(createProject(repoPath));
    await expect(
      service.updateDocument("project-1", { content: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
