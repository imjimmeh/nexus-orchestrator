import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import type { CharterAggregateService } from "./charter-aggregate.service";
import type { ProjectAgentsFileService } from "./project-agents-file.service";
import { ProjectController } from "./project.controller";
import type { ProjectMemorySummaryService } from "./project-memory-summary.service";
import type { ProjectRepositoryMetadataService } from "./project-repository-metadata.service";
import type { ProjectService } from "./project.service";

describe("ProjectController", () => {
  const createController = ({
    projects = {},
    coreClient = {},
    projectMemorySummary = {},
    repositoryMetadata = {},
    agentsFile = {},
    charterAggregate = {},
  }: {
    projects?: Partial<ProjectService>;
    coreClient?: Partial<CoreWorkflowClientService>;
    projectMemorySummary?: Partial<ProjectMemorySummaryService>;
    repositoryMetadata?: Partial<ProjectRepositoryMetadataService>;
    agentsFile?: Partial<ProjectAgentsFileService>;
    charterAggregate?: Partial<CharterAggregateService>;
  }) =>
    new ProjectController(
      projects as ProjectService,
      coreClient as CoreWorkflowClientService,
      projectMemorySummary as ProjectMemorySummaryService,
      repositoryMetadata as ProjectRepositoryMetadataService,
      agentsFile as ProjectAgentsFileService,
      charterAggregate as CharterAggregateService,
    );

  describe("launchCharterOnboarding", () => {
    function makeService(mock: ReturnType<typeof vi.fn>) {
      return createController({
        projects: { launchCharterOnboarding: mock },
      });
    }

    it("passes brownfield mode through to the service", async () => {
      const launch = vi.fn().mockResolvedValue({ onboardingRunId: "run-1" });
      const controller = makeService(launch);

      const response = await controller.launchCharterOnboarding("proj-1", {
        mode: "brownfield",
      });

      expect(launch).toHaveBeenCalledWith("proj-1", "brownfield");
      expect(response).toEqual({
        success: true,
        data: { onboardingRunId: "run-1" },
      });
    });

    it("passes greenfield mode through to the service", async () => {
      const launch = vi.fn().mockResolvedValue({ onboardingRunId: "run-2" });
      const controller = makeService(launch);

      await controller.launchCharterOnboarding("proj-1", {
        mode: "greenfield",
      });

      expect(launch).toHaveBeenCalledWith("proj-1", "greenfield");
    });

    it("passes refine mode through to the service", async () => {
      const launch = vi.fn().mockResolvedValue({ onboardingRunId: "run-3" });
      const controller = makeService(launch);

      await controller.launchCharterOnboarding("proj-1", { mode: "refine" });

      expect(launch).toHaveBeenCalledWith("proj-1", "refine");
    });

    it("defaults to greenfield when no mode is provided", async () => {
      const launch = vi.fn().mockResolvedValue({ onboardingRunId: "run-4" });
      const controller = makeService(launch);

      await controller.launchCharterOnboarding("proj-1", {});

      expect(launch).toHaveBeenCalledWith("proj-1", "greenfield");
    });

    it("defaults to greenfield for an unrecognised mode value", async () => {
      const launch = vi.fn().mockResolvedValue({ onboardingRunId: "run-5" });
      const controller = makeService(launch);

      await controller.launchCharterOnboarding("proj-1", { mode: "unknown" });

      expect(launch).toHaveBeenCalledWith("proj-1", "greenfield");
    });
  });

  it("exposes project settings updates", async () => {
    const updateMock = vi.fn();
    const updatedProject = {
      id: "project-1",
      name: "Updated project",
      goals: null,
      repositoryUrl: "https://github.com/org/repo.git",
      basePath: "G:\\workspace\\repo",
      githubSecretId: "secret-1",
      description: "Updated description",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
    };
    const service = {
      update: updateMock.mockResolvedValue(updatedProject),
    };
    const controller = createController({ projects: service });
    const body = {
      name: "Updated project",
      repositoryUrl: "https://github.com/org/repo.git",
      basePath: "G:\\workspace\\repo",
      githubSecretId: "secret-1",
      description: "Updated description",
    };

    const response = await controller.update("project-1", body);

    expect(updateMock).toHaveBeenCalledWith("project-1", body);
    expect(response).toEqual({ success: true, data: updatedProject });
  });

  describe("repository workflow settings", () => {
    it("GET :project_id/repository-workflows/settings returns settings", async () => {
      const getSettingsMock = vi.fn();
      const settings = {
        enabled: false,
        overrides: { "wf-1": { enabled: true } },
      };
      const service = {
        getRepositoryWorkflowSettings:
          getSettingsMock.mockResolvedValue(settings),
      };
      const controller = createController({ projects: service });

      const response = await (controller as any).getRepositoryWorkflowSettings(
        "project-1",
      );

      expect(getSettingsMock).toHaveBeenCalledWith("project-1");
      expect(response).toEqual({ success: true, data: settings });
    });

    it("PATCH :project_id/repository-workflows/settings updates and returns settings", async () => {
      const updateSettingsMock = vi.fn();
      const settings = { enabled: false, overrides: {} };
      const service = {
        updateRepositoryWorkflowSettings:
          updateSettingsMock.mockResolvedValue(settings),
      };
      const controller = createController({ projects: service });
      const body = { enabled: false };

      const response = await (
        controller as any
      ).updateRepositoryWorkflowSettings("project-1", body);

      expect(updateSettingsMock).toHaveBeenCalledWith("project-1", body);
      expect(response).toEqual({ success: true, data: settings });
    });
  });

  describe("project repository metadata", () => {
    it("lists repository branches", async () => {
      const repositoryMetadata = {
        listBranches: vi.fn().mockResolvedValue(["main", "feature/a"]),
      };
      const controller = createController({ repositoryMetadata });

      const response = await controller.listRepositoryBranches("project-1");

      expect(repositoryMetadata.listBranches).toHaveBeenCalledWith("project-1");
      expect(response).toEqual({ success: true, data: ["main", "feature/a"] });
    });

    it("lists repository files", async () => {
      const repositoryMetadata = {
        listFiles: vi.fn().mockResolvedValue(["README.md", "src/index.ts"]),
      };
      const controller = createController({ repositoryMetadata });

      const response = await controller.listRepositoryFiles("project-1");

      expect(repositoryMetadata.listFiles).toHaveBeenCalledWith("project-1");
      expect(response).toEqual({
        success: true,
        data: ["README.md", "src/index.ts"],
      });
    });

    it("reads repository file content", async () => {
      const fileContent = {
        content: "# Project",
        path: "README.md",
        branch: "main",
        size: 9,
      };
      const repositoryMetadata = {
        getFileContent: vi.fn().mockResolvedValue(fileContent),
      };
      const controller = createController({ repositoryMetadata });

      const response = await controller.getRepositoryFileContent(
        "project-1",
        "README.md",
        "main",
      );

      expect(repositoryMetadata.getFileContent).toHaveBeenCalledWith(
        "project-1",
        "README.md",
        "main",
      );
      expect(response).toEqual({ success: true, data: fileContent });
    });

    it("rejects repository file content requests without a path", async () => {
      const controller = createController({});

      await expect(
        controller.getRepositoryFileContent("project-1", "", "main"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("project agents file", () => {
    it("returns the project AGENTS.md document", async () => {
      const document = {
        status: "present",
        content: "# Agent instructions",
        etag: "etag-1",
        updatedAt: "2026-06-05T00:00:00.000Z",
      };
      const agentsFile = {
        getDocument: vi.fn().mockResolvedValue(document),
      };
      const controller = createController({ agentsFile });

      const response = await controller.getProjectAgentsFile("project-1");

      expect(agentsFile.getDocument).toHaveBeenCalledWith("project-1");
      expect(response).toEqual({ success: true, data: document });
    });

    it("updates the project AGENTS.md document", async () => {
      const document = {
        status: "present",
        content: "# Updated instructions",
        etag: "etag-2",
        updatedAt: "2026-06-05T00:00:01.000Z",
      };
      const agentsFile = {
        updateDocument: vi.fn().mockResolvedValue(document),
      };
      const controller = createController({ agentsFile });
      const body = {
        content: "# Updated instructions",
        expected_etag: "etag-1",
      };

      const response = await controller.updateProjectAgentsFile(
        "project-1",
        body,
      );

      expect(agentsFile.updateDocument).toHaveBeenCalledWith("project-1", body);
      expect(response).toEqual({ success: true, data: document });
    });
  });

  describe("project memory segments", () => {
    it("GET :project_id/memory/segments returns project memory segments", async () => {
      const getSegmentsMock = vi.fn();
      const segments = { items: [], total: 0, limit: 10, offset: 0 };
      const projectMemorySummary = {
        getProjectMemorySegments: getSegmentsMock.mockResolvedValue(segments),
      };
      const controller = createController({ projectMemorySummary });

      const response = await controller.getMemorySegments("project-1", {
        limit: "10",
        offset: "0",
        memory_type: "preference",
        query: "search",
      });

      expect(getSegmentsMock).toHaveBeenCalledWith("project-1", {
        limit: 10,
        offset: 0,
        memory_type: "preference",
        query: "search",
      });
      expect(response).toEqual({ success: true, data: segments });
    });
  });

  describe("charter memories", () => {
    it("GET :project_id/charter-memories returns grouped memories", async () => {
      const rows = [
        {
          id: "m1",
          content: "Must have SSO",
          memory_type: "fact",
          metadata: { category: "requirement", source: "user_edit" },
          created_at: "",
          updated_at: "",
        },
        {
          id: "m2",
          content: "No IE11",
          memory_type: "fact",
          metadata: { category: "constraint", source: "user_edit" },
          created_at: "",
          updated_at: "",
        },
      ];
      const getMock = vi.fn().mockResolvedValue(rows);
      const controller = createController({
        projectMemorySummary: { getCharterMemories: getMock },
      });

      const response = await controller.getCharterMemories("p1");

      expect(getMock).toHaveBeenCalledWith("p1");
      expect(response).toEqual({
        success: true,
        data: {
          requirement: [rows[0]],
          constraint: [rows[1]],
        },
      });
    });

    it("POST :project_id/charter-memories creates a memory", async () => {
      const created = {
        id: "m3",
        content: "Must support SSO",
        memory_type: "fact",
        metadata: { category: "requirement", source: "user_edit" },
        created_at: "",
        updated_at: "",
      };
      const createMock = vi.fn().mockResolvedValue(created);
      const controller = createController({
        projectMemorySummary: { createCharterMemory: createMock },
      });

      const response = await controller.createCharterMemory("p1", {
        category: "requirement",
        content: "Must support SSO",
      });

      expect(createMock).toHaveBeenCalledWith(
        "p1",
        "requirement",
        "Must support SSO",
        "fact",
      );
      expect(response).toEqual({ success: true, data: created });
    });

    it("POST :project_id/charter-memories rejects unknown category", async () => {
      const controller = createController({
        projectMemorySummary: { createCharterMemory: vi.fn() },
      });
      await expect(
        controller.createCharterMemory("p1", {
          category: "bogus",
          content: "x",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("PATCH :project_id/charter-memories/:memoryId updates content", async () => {
      const updated = {
        id: "m1",
        content: "Updated",
        memory_type: "fact",
        metadata: { category: "requirement", source: "user_edit" },
        created_at: "",
        updated_at: "",
      };
      const updateMock = vi.fn().mockResolvedValue(updated);
      const controller = createController({
        projectMemorySummary: { updateCharterMemory: updateMock },
      });

      const response = await controller.updateCharterMemory("p1", "m1", {
        content: "Updated",
      });

      expect(updateMock).toHaveBeenCalledWith("m1", "p1", "Updated");
      expect(response).toEqual({ success: true, data: updated });
    });

    it("PATCH :project_id/charter-memories/:memoryId throws 404 when not found", async () => {
      const controller = createController({
        projectMemorySummary: {
          updateCharterMemory: vi.fn().mockResolvedValue(null),
        },
      });
      await expect(
        controller.updateCharterMemory("p1", "missing", { content: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("DELETE :project_id/charter-memories/:memoryId deletes the memory", async () => {
      const deleteMock = vi.fn().mockResolvedValue(true);
      const controller = createController({
        projectMemorySummary: { deleteCharterMemory: deleteMock },
      });

      const response = await controller.deleteCharterMemory("p1", "m1");

      expect(deleteMock).toHaveBeenCalledWith("m1", "p1");
      expect(response).toEqual({ success: true });
    });

    it("DELETE :project_id/charter-memories/:memoryId throws 404 when not found", async () => {
      const controller = createController({
        projectMemorySummary: {
          deleteCharterMemory: vi.fn().mockResolvedValue(false),
        },
      });
      await expect(
        controller.deleteCharterMemory("p1", "missing"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("listWorkflowFiles — YAML trigger enrichment", () => {
    const BEFORE_YAML = `workflow_id: pre_merge_ci
name: Pre-Merge CI
trigger:
  type: lifecycle
  phase: ready-to-merge
  hook: before
  blocking: true
jobs: []`.trim();

    const AFTER_YAML = `workflow_id: post_merge_notify
name: Post-Merge Notify
trigger:
  type: lifecycle
  phase: done
  hook: after
  blocking: false
jobs: []`.trim();

    const NON_LIFECYCLE_YAML = `workflow_id: manual_wf
name: Manual
trigger:
  type: manual
jobs: []`.trim();

    const MALFORMED_YAML = `not: valid: yaml: [[[`;

    function makeForWorkflowFiles(
      files: Array<{ path: string; size: number }>,
      contentByFilename: Record<string, string>,
    ) {
      return createController({
        projects: { get: vi.fn().mockResolvedValue({ basePath: "/repo" }) },
        coreClient: {
          listRepoFiles: vi.fn().mockResolvedValue({ files }),
          readRepoFile: vi
            .fn()
            .mockImplementation(({ filePath }: { filePath: string }) => {
              const filename = filePath.split("/").at(-1) ?? "";
              const content = contentByFilename[filename];
              if (!content) throw new Error(`not found: ${filePath}`);
              return { content };
            }),
        },
      });
    }

    it("attaches parsed lifecycle trigger to each file", async () => {
      const controller = makeForWorkflowFiles(
        [
          {
            path: ".nexus/workflows/ready-to-merge.before.workflow.yaml",
            size: 100,
          },
          { path: ".nexus/workflows/post-done.after.workflow.yaml", size: 80 },
        ],
        {
          "ready-to-merge.before.workflow.yaml": BEFORE_YAML,
          "post-done.after.workflow.yaml": AFTER_YAML,
        },
      );

      const result = await controller.listWorkflowFiles("proj-1");

      expect(result.files[0].trigger).toEqual({
        phase: "ready-to-merge",
        hook: "before",
        blocking: true,
      });
      expect(result.files[1].trigger).toEqual({
        phase: "done",
        hook: "after",
        blocking: false,
      });
    });

    it("returns trigger: null for non-lifecycle triggers", async () => {
      const controller = makeForWorkflowFiles(
        [{ path: ".nexus/workflows/manual.workflow.yaml", size: 50 }],
        { "manual.workflow.yaml": NON_LIFECYCLE_YAML },
      );
      const result = await controller.listWorkflowFiles("proj-1");
      expect(result.files[0].trigger).toBeNull();
    });

    it("defaults blocking to true for before-hooks when blocking field is omitted", async () => {
      const YAML_NO_BLOCKING = `workflow_id: wf
name: WF
trigger:
  type: lifecycle
  phase: ready-to-merge
  hook: before
jobs: []`.trim();

      const controller = makeForWorkflowFiles(
        [{ path: ".nexus/workflows/wf.workflow.yaml", size: 40 }],
        { "wf.workflow.yaml": YAML_NO_BLOCKING },
      );
      const result = await controller.listWorkflowFiles("proj-1");
      expect(result.files[0].trigger).toEqual({
        phase: "ready-to-merge",
        hook: "before",
        blocking: true,
      });
    });

    it("returns trigger: null when YAML is malformed", async () => {
      const controller = makeForWorkflowFiles(
        [{ path: ".nexus/workflows/broken.workflow.yaml", size: 10 }],
        { "broken.workflow.yaml": MALFORMED_YAML },
      );
      const result = await controller.listWorkflowFiles("proj-1");
      expect(result.files[0].trigger).toBeNull();
    });

    it("returns trigger: null when file cannot be read", async () => {
      const controller = makeForWorkflowFiles(
        [{ path: ".nexus/workflows/missing.workflow.yaml", size: 0 }],
        {},
      );
      const result = await controller.listWorkflowFiles("proj-1");
      expect(result.files[0].trigger).toBeNull();
    });
  });
});
