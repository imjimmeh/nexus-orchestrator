import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { KanbanCoreRunProjectionRepository } from "../database/repositories/kanban-core-run-projection.repository";
import type { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import type { KanbanProjectGoalRepository } from "../database/repositories/kanban-project-goal.repository";
import type { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import type { ManagedProjectCloneService } from "./managed-project-clone.service";
import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import type { CoreScopeClientService } from "../core/core-scope-client.service";
import type { OrchestrationLeaseService } from "../orchestration/control-plane/orchestration-lease.service";
import { ProjectService } from "./project.service";

type MockProjectRepository = {
  save: Mock;
  findAll: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  removeById: ReturnType<typeof vi.fn>;
};

type MockGoalRepository = {
  create: ReturnType<typeof vi.fn>;
  deleteByproject_id: ReturnType<typeof vi.fn>;
};

type MockWorkItemRepository = {
  deleteByproject_id: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
};

type MockOrchestrationRepository = {
  deleteByproject_id: ReturnType<typeof vi.fn>;
};

type MockCoreRunProjectionRepository = {
  deleteByproject_id: ReturnType<typeof vi.fn>;
};

type MockManagedProjectCloneService = {
  startClone: ReturnType<typeof vi.fn>;
};

type MockCoreWorkflowClientService = {
  cancelWorkflowRunsByScope: ReturnType<typeof vi.fn>;
  requestWorkflowRun: ReturnType<typeof vi.fn>;
};

type MockCoreScopeClientService = {
  ensureProjectNode: ReturnType<typeof vi.fn>;
};

type MockOrchestrationLeaseService = {
  releaseAllForProject: ReturnType<typeof vi.fn>;
};

function buildProjectEntity(
  overrides: Partial<{
    id: string;
    name: string;
    goals: string | null;
    repository_url: string | null;
    base_path: string | null;
    github_secret_id: string | null;
    description: string | null;
    source_type: string | null;
    copy_to_workspace: boolean | null;
    repository_workflow_settings: Record<string, unknown> | null;
    orchestration_settings: Record<string, unknown> | null;
    runtime_toolchains: {
      toolchains: Array<{ tool: string; version: string }>;
    } | null;
    created_at: Date;
    updated_at: Date;
  }> = {},
) {
  return {
    id: overrides.id ?? "project-1",
    name: overrides.name ?? "Alpha",
    goals: overrides.goals ?? null,
    repository_url: overrides.repository_url ?? null,
    base_path: overrides.base_path ?? null,
    github_secret_id: overrides.github_secret_id ?? null,
    description: overrides.description ?? null,
    source_type: overrides.source_type ?? null,
    copy_to_workspace: overrides.copy_to_workspace ?? null,
    repository_workflow_settings:
      overrides.repository_workflow_settings ?? null,
    orchestration_settings: overrides.orchestration_settings ?? null,
    runtime_toolchains: overrides.runtime_toolchains ?? null,
    created_at: overrides.created_at ?? new Date("2026-04-14T00:00:00.000Z"),
    updated_at: overrides.updated_at ?? new Date("2026-04-14T00:00:01.000Z"),
  };
}

describe("ProjectService", () => {
  let repository: MockProjectRepository;
  let goals: MockGoalRepository;
  let workItems: MockWorkItemRepository;
  let orchestrations: MockOrchestrationRepository;
  let coreRunProjections: MockCoreRunProjectionRepository;
  let managedClones: MockManagedProjectCloneService;
  let coreWorkflowClient: MockCoreWorkflowClientService;
  let coreScopeClient: MockCoreScopeClientService;
  let leaseService: MockOrchestrationLeaseService;
  let service: ProjectService;

  beforeEach(() => {
    repository = {
      save: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      removeById: vi.fn(),
    };
    goals = {
      create: vi.fn(),
      deleteByproject_id: vi.fn(),
    };
    workItems = {
      deleteByproject_id: vi.fn(),
      save: vi.fn(),
    };
    orchestrations = {
      deleteByproject_id: vi.fn(),
    };
    coreRunProjections = {
      deleteByproject_id: vi.fn(),
    };
    managedClones = {
      startClone: vi.fn(),
    };
    coreWorkflowClient = {
      cancelWorkflowRunsByScope: vi.fn(),
      requestWorkflowRun: vi.fn(),
    };
    coreScopeClient = {
      ensureProjectNode: vi
        .fn()
        .mockResolvedValue({ id: "default-project-id" }),
    };
    leaseService = {
      releaseAllForProject: vi.fn(),
    };
    service = new ProjectService(
      repository as unknown as KanbanProjectRepository,
      goals as unknown as KanbanProjectGoalRepository,
      workItems as unknown as KanbanWorkItemRepository,
      orchestrations as unknown as KanbanOrchestrationRepository,
      coreRunProjections as unknown as KanbanCoreRunProjectionRepository,
      coreWorkflowClient as unknown as CoreWorkflowClientService,
      managedClones as unknown as ManagedProjectCloneService,
      coreScopeClient as unknown as CoreScopeClientService,
      leaseService as unknown as OrchestrationLeaseService,
    );
  });

  it("creates projects in kanban persistence without calling core project routes", async () => {
    repository.save.mockResolvedValue(
      buildProjectEntity({
        id: "project-created",
        name: "New split project",
        description: "from github",
        repository_url: "https://github.com/org/repo",
        base_path: "/opt/checkout",
        github_secret_id: "secret-id",
        source_type: "import_remote",
        copy_to_workspace: false,
      }),
    );

    const created = await service.create({
      name: "New split project",
      description: "from github",
      sourceType: "import_remote",
      repositoryUrl: "https://github.com/org/repo",
      basePath: "/opt/checkout",
      githubSecretId: "secret-id",
      copyToWorkspace: false,
      goals: [{ title: "  Validate sync  ", moscow: "must" }],
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New split project",
        description: "from github",
        repository_url: "https://github.com/org/repo",
        base_path: "/opt/checkout",
        github_secret_id: "secret-id",
        source_type: "import_remote",
        copy_to_workspace: false,
      }),
    );
    expect(goals.create).toHaveBeenCalledWith("project-created", {
      title: "Validate sync",
      moscow: "must",
    });
    expect(created).toEqual(
      expect.objectContaining({
        id: "project-created",
        name: "New split project",
        goals: null,
      }),
    );
  });

  it("registers a project scope node when a kanban project is created", async () => {
    repository.save.mockResolvedValue(
      buildProjectEntity({
        id: "proj-uuid",
        name: "Web App",
      }),
    );
    coreScopeClient.ensureProjectNode.mockResolvedValue({ id: "proj-uuid" });

    await service.create({ name: "Web App" });

    expect(coreScopeClient.ensureProjectNode).toHaveBeenCalledWith(
      expect.objectContaining({ id: "proj-uuid", type: "project" }),
    );
  });

  it("starts a managed clone after creating remote imports without a base path", async () => {
    repository.save.mockResolvedValue(
      buildProjectEntity({
        id: "project-created",
        name: "Remote project",
        repository_url: "https://github.com/org/repo.git",
        base_path: null,
        source_type: "import_remote",
      }),
    );
    goals.create.mockResolvedValue(undefined);

    const created = await service.create({
      name: "Remote project",
      sourceType: "import_remote",
      repositoryUrl: "https://github.com/org/repo.git",
      goals: [{ title: "Persist goal first" }],
    });

    expect(created.id).toBe("project-created");
    expect(goals.create).toHaveBeenCalledWith("project-created", {
      title: "Persist goal first",
    });
    expect(managedClones.startClone).toHaveBeenCalledWith("project-created");
    expect(goals.create.mock.invocationCallOrder[0]).toBeLessThan(
      managedClones.startClone.mock.invocationCallOrder[0],
    );
  });

  it.each([
    [
      "credential-bearing HTTPS URL",
      "https://token:secret@github.com/org/repo.git",
    ],
    [
      "HTTPS URL with query string",
      "https://github.com/org/repo.git?token=secret",
    ],
    ["HTTPS URL with fragment", "https://github.com/org/repo.git#secret"],
    ["local relative repository input", "org/repo.git"],
    ["local absolute repository input", "G:\\repos\\repo.git"],
    ["file repository input", "file:///G:/repos/repo.git"],
    ["unsupported HTTP scheme", "http://github.com/org/repo.git"],
  ])(
    "rejects unsafe managed clone %s before persistence side effects",
    async (_caseName, repositoryUrl) => {
      repository.save.mockResolvedValue(
        buildProjectEntity({ id: "project-created" }),
      );

      await expect(
        service.create({
          name: "Unsafe remote project",
          sourceType: "import_remote",
          repositoryUrl,
          goals: [{ title: "Should not persist" }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.save).not.toHaveBeenCalled();
      expect(goals.create).not.toHaveBeenCalled();
      expect(managedClones.startClone).not.toHaveBeenCalled();
    },
  );

  it("rejects unsafe remote import repository URLs before persistence even when basePath already exists", async () => {
    repository.save.mockResolvedValue(
      buildProjectEntity({ id: "project-created" }),
    );

    await expect(
      service.create({
        name: "Mounted unsafe remote project",
        sourceType: "import_remote",
        repositoryUrl: "https://github.com/org/repo.git?token=secret",
        basePath: "G:\\workspace\\repo",
        goals: [{ title: "Should not persist" }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.save).not.toHaveBeenCalled();
    expect(goals.create).not.toHaveBeenCalled();
    expect(managedClones.startClone).not.toHaveBeenCalled();
  });

  it("rejects unsafe nonblank repository URLs before persistence for non-managed clone project inputs", async () => {
    repository.save.mockResolvedValue(
      buildProjectEntity({ id: "project-created" }),
    );

    await expect(
      service.create({
        name: "Local unsafe project",
        sourceType: "import_local",
        repositoryUrl: "file:///G:/repos/repo.git",
        goals: [{ title: "Should not persist" }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.save).not.toHaveBeenCalled();
    expect(goals.create).not.toHaveBeenCalled();
    expect(managedClones.startClone).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "Local import",
      input: {
        name: "Local project",
        sourceType: "import_local" as const,
        repositoryUrl: "https://github.com/org/repo.git",
      },
    },
    {
      name: "Remote import with blank repository URL",
      input: {
        name: "Blank remote project",
        sourceType: "import_remote" as const,
        repositoryUrl: "   ",
      },
    },
    {
      name: "Remote import with existing base path",
      input: {
        name: "Mounted remote project",
        sourceType: "import_remote" as const,
        repositoryUrl: "https://github.com/org/repo.git",
        basePath: "G:\\workspace\\repo",
      },
    },
  ])("does not start a managed clone for $name", async ({ input }) => {
    repository.save.mockResolvedValue(
      buildProjectEntity({ id: "project-created" }),
    );

    await service.create(input);

    expect(managedClones.startClone).not.toHaveBeenCalled();
  });

  it("lists projects from kanban persistence only", async () => {
    repository.findAll.mockResolvedValue([
      buildProjectEntity({ id: "project-1", name: "Local project" }),
    ]);

    const projects = await service.list();

    expect(projects).toEqual([
      expect.objectContaining({ id: "project-1", name: "Local project" }),
    ]);
  });

  it("gets projects from kanban persistence only", async () => {
    repository.findById.mockResolvedValue(
      buildProjectEntity({
        id: "project-2",
        name: "Stored project",
        description: "Stored description",
        repository_url: "https://github.com/org/repo.git",
        base_path: "G:\\workspace\\repo",
        github_secret_id: "secret-1",
        source_type: "import_remote",
      }),
    );

    const project = await service.get("project-2");

    expect(project).toEqual(
      expect.objectContaining({
        id: "project-2",
        name: "Stored project",
        description: "Stored description",
        repositoryUrl: "https://github.com/org/repo.git",
        basePath: "G:\\workspace\\repo",
        githubSecretId: "secret-1",
      }),
    );
  });

  it("updates project settings including GitHub auth secret", async () => {
    repository.findById.mockResolvedValue(
      buildProjectEntity({
        id: "project-2",
        name: "Stored project",
        repository_url: "https://github.com/org/old.git",
        github_secret_id: null,
      }),
    );
    repository.save.mockResolvedValue(
      buildProjectEntity({
        id: "project-2",
        name: "Updated project",
        description: "Updated description",
        repository_url: "https://github.com/org/new.git",
        base_path: "G:\\workspace\\repo",
        github_secret_id: "secret-1",
      }),
    );

    const project = await service.update("project-2", {
      name: "Updated project",
      description: "Updated description",
      repositoryUrl: "https://github.com/org/new.git",
      basePath: "G:\\workspace\\repo",
      githubSecretId: "secret-1",
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "project-2",
        name: "Updated project",
        description: "Updated description",
        repository_url: "https://github.com/org/new.git",
        base_path: "G:\\workspace\\repo",
        github_secret_id: "secret-1",
      }),
    );
    expect(project).toEqual(
      expect.objectContaining({
        id: "project-2",
        name: "Updated project",
        description: "Updated description",
        repositoryUrl: "https://github.com/org/new.git",
        basePath: "G:\\workspace\\repo",
        githubSecretId: "secret-1",
      }),
    );
  });

  it("updates project settings without dropping existing fields needed for the response", async () => {
    const existingProject = buildProjectEntity({
      id: "project-2",
      name: "Stored project",
      source_type: "import_remote",
      created_at: new Date("2026-04-14T00:00:00.000Z"),
      updated_at: new Date("2026-04-14T00:00:01.000Z"),
    });
    repository.findById.mockResolvedValue(existingProject);
    repository.save.mockImplementation((project: unknown) =>
      Promise.resolve(project),
    );

    const project = await service.update("project-2", {
      githubSecretId: "secret-1",
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "project-2",
        name: "Stored project",
        source_type: "import_remote",
        created_at: existingProject.created_at,
        updated_at: existingProject.updated_at,
        github_secret_id: "secret-1",
      }),
    );
    expect(project).toEqual(
      expect.objectContaining({
        id: "project-2",
        name: "Stored project",
        sourceType: "import_remote",
        githubSecretId: "secret-1",
        createdAt: "2026-04-14T00:00:00.000Z",
      }),
    );
  });

  it("throws NotFoundException when a kanban-owned project is missing", async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.get("missing-project")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("cancels active workflow runs when deleting a project, but still deletes the project record", async () => {
    repository.findById.mockResolvedValue(
      buildProjectEntity({ id: "project-1" }),
    );
    repository.removeById.mockResolvedValue(undefined);
    workItems.deleteByproject_id.mockResolvedValue(undefined);
    orchestrations.deleteByproject_id.mockResolvedValue(undefined);
    goals.deleteByproject_id.mockResolvedValue(undefined);
    coreRunProjections.deleteByproject_id.mockResolvedValue(undefined);

    coreWorkflowClient.cancelWorkflowRunsByScope.mockResolvedValue({
      scopeId: "project-1",
      requestedRuns: 2,
      cancelledRuns: 2,
      skippedRuns: 0,
      cancelledRunIds: ["run-1", "run-2"],
      reason: "project_deleted",
      metadata: {
        correlationId: "corr-id",
        requestedBy: "kanban",
      },
    });

    await service.delete("project-1");

    expect(coreWorkflowClient.cancelWorkflowRunsByScope).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ reason: "project_deleted" }),
    );
    expect(workItems.deleteByproject_id).toHaveBeenCalledWith("project-1");
    expect(orchestrations.deleteByproject_id).toHaveBeenCalledWith("project-1");
    expect(goals.deleteByproject_id).toHaveBeenCalledWith("project-1");
    expect(coreRunProjections.deleteByproject_id).toHaveBeenCalledWith(
      "project-1",
    );
  });

  describe("resetBlockedIntents", () => {
    it("releases all leases for the project and returns the count", async () => {
      repository.findById.mockResolvedValue(
        buildProjectEntity({ id: "project-1" }),
      );
      leaseService.releaseAllForProject.mockResolvedValue(3);

      const result = await service.resetBlockedIntents("project-1");

      expect(leaseService.releaseAllForProject).toHaveBeenCalledWith(
        "project-1",
      );
      expect(result).toEqual({ count: 3 });
    });

    it("returns zero when no leases are held", async () => {
      repository.findById.mockResolvedValue(
        buildProjectEntity({ id: "project-1" }),
      );
      leaseService.releaseAllForProject.mockResolvedValue(0);

      const result = await service.resetBlockedIntents("project-1");

      expect(result).toEqual({ count: 0 });
    });

    it("throws NotFoundException when project does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.resetBlockedIntents("missing-project"),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(leaseService.releaseAllForProject).not.toHaveBeenCalled();
    });
  });

  it("ignores workflow-cancel failures during project deletion", async () => {
    repository.findById.mockResolvedValue(
      buildProjectEntity({ id: "project-1" }),
    );
    repository.removeById.mockResolvedValue(undefined);
    workItems.deleteByproject_id.mockResolvedValue(undefined);
    orchestrations.deleteByproject_id.mockResolvedValue(undefined);
    goals.deleteByproject_id.mockResolvedValue(undefined);
    coreRunProjections.deleteByproject_id.mockResolvedValue(undefined);

    coreWorkflowClient.cancelWorkflowRunsByScope.mockRejectedValue(
      new Error("temporary API outage"),
    );

    await expect(service.delete("project-1")).resolves.toBeUndefined();

    expect(coreWorkflowClient.cancelWorkflowRunsByScope).toHaveBeenCalled();
    expect(workItems.deleteByproject_id).toHaveBeenCalledWith("project-1");
    expect(repository.removeById).toHaveBeenCalledWith("project-1");
  });

  describe("repository workflow settings", () => {
    it("returns default settings when project has null settings", async () => {
      repository.findById.mockResolvedValue(
        buildProjectEntity({
          id: "project-1",
          repository_workflow_settings: null,
        }),
      );

      const settings = await (service as any).getRepositoryWorkflowSettings(
        "project-1",
      );

      expect(settings).toEqual({ enabled: true, overrides: {} });
    });

    it("returns parsed settings when project has them", async () => {
      repository.findById.mockResolvedValue(
        buildProjectEntity({
          id: "project-1",
          repository_workflow_settings: {
            enabled: false,
            overrides: { "wf-1": { enabled: true } },
          },
        }),
      );

      const settings = await (service as any).getRepositoryWorkflowSettings(
        "project-1",
      );

      expect(settings).toEqual({
        enabled: false,
        overrides: { "wf-1": { enabled: true } },
      });
    });

    it("getRepositoryWorkflowSettings throws NotFoundException for missing project", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        (service as any).getRepositoryWorkflowSettings("missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("merges enabled and overrides on update", async () => {
      repository.findById.mockResolvedValue(
        buildProjectEntity({
          id: "project-1",
          repository_workflow_settings: {
            enabled: true,
            overrides: { "wf-1": { enabled: false } },
          },
        }),
      );
      repository.save.mockResolvedValue(
        buildProjectEntity({ id: "project-1" }),
      );

      const settings = await (service as any).updateRepositoryWorkflowSettings(
        "project-1",
        { enabled: false, overrides: { "wf-2": { enabled: false } } },
      );

      expect(settings).toEqual({
        enabled: false,
        overrides: { "wf-1": { enabled: false }, "wf-2": { enabled: false } },
      });
    });

    it("updateRepositoryWorkflowSettings throws NotFoundException for missing project", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        (service as any).updateRepositoryWorkflowSettings("missing", {
          enabled: false,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("updateRepositoryWorkflowSettings preserves ALL existing project fields (not nullable bug)", async () => {
      const existing = buildProjectEntity({
        id: "project-1",
        name: "My Project",
        repository_url: "https://github.com/org/repo.git",
        base_path: "/opt/checkout",
        github_secret_id: "secret-1",
        description: "A description",
        source_type: "import_remote",
        copy_to_workspace: true,
        created_at: new Date("2026-05-01T00:00:00.000Z"),
        updated_at: new Date("2026-05-01T00:00:01.000Z"),
        repository_workflow_settings: { enabled: true, overrides: {} },
      });
      repository.findById.mockResolvedValue(existing);
      repository.save.mockResolvedValue(existing);

      await (service as any).updateRepositoryWorkflowSettings("project-1", {
        enabled: false,
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "project-1",
          name: "My Project",
          repository_url: "https://github.com/org/repo.git",
          base_path: "/opt/checkout",
          github_secret_id: "secret-1",
          description: "A description",
          source_type: "import_remote",
          copy_to_workspace: true,
          created_at: existing.created_at,
          updated_at: existing.updated_at,
          repository_workflow_settings: expect.objectContaining({
            enabled: false,
          }),
        }),
      );
    });

    it("update() preserves repository_workflow_settings", async () => {
      const existing = buildProjectEntity({
        id: "project-1",
        name: "Existing",
        repository_workflow_settings: {
          enabled: false,
          overrides: { "wf-99": { enabled: true } },
        },
      });
      repository.findById.mockResolvedValue(existing);
      repository.save.mockResolvedValue(existing);

      await service.update("project-1", { name: "Renamed" });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          repository_workflow_settings: {
            enabled: false,
            overrides: { "wf-99": { enabled: true } },
          },
        }),
      );
    });

    it("update() preserves runtime_toolchains when not provided", async () => {
      const existing = buildProjectEntity({
        id: "project-1",
        name: "Existing",
        runtime_toolchains: {
          toolchains: [{ tool: "go", version: "1.23" }],
        },
      });
      repository.findById.mockResolvedValue(existing);
      repository.save.mockResolvedValue(existing);

      await service.update("project-1", { name: "Renamed" });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime_toolchains: {
            toolchains: [{ tool: "go", version: "1.23" }],
          },
        }),
      );
    });

    it("update() sets runtime_toolchains when provided", async () => {
      const existing = buildProjectEntity({ id: "project-1" });
      repository.findById.mockResolvedValue(existing);
      repository.save.mockImplementation((project: unknown) =>
        Promise.resolve(project),
      );

      const project = await service.update("project-1", {
        runtime_toolchains: { toolchains: [{ tool: "node", version: "20" }] },
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime_toolchains: { toolchains: [{ tool: "node", version: "20" }] },
        }),
      );
      expect(project.runtime_toolchains).toEqual({
        toolchains: [{ tool: "node", version: "20" }],
      });
    });

    it("update() clears runtime_toolchains when explicitly set to null", async () => {
      const existing = buildProjectEntity({
        id: "project-1",
        runtime_toolchains: { toolchains: [{ tool: "go", version: "1.23" }] },
      });
      repository.findById.mockResolvedValue(existing);
      repository.save.mockImplementation((project: unknown) =>
        Promise.resolve(project),
      );

      await service.update("project-1", { runtime_toolchains: null });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ runtime_toolchains: null }),
      );
    });
  });

  it("creates an ingestion work item and triggers design_ingestion_new_project when ingestionInputs is provided", async () => {
    repository.save.mockResolvedValue(
      buildProjectEntity({ id: "project-ingestion", name: "AI Assistant" }),
    );
    goals.create.mockResolvedValue(undefined);
    workItems.save.mockResolvedValue({ id: "work-item-ingestion" });
    coreWorkflowClient.requestWorkflowRun.mockResolvedValue({
      run_id: "run-ingestion-1",
      workflow_id: "design_ingestion_new_project",
      status: "accepted",
      accepted_at: "2026-06-08T00:00:00.000Z",
      metadata: { correlation_id: "corr-1" },
    });

    await service.create({
      name: "AI Assistant",
      ingestionInputs: {
        files: ["design.png"],
        urls: ["https://example.com/spec"],
      },
    });

    expect(workItems.save).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "project-ingestion",
        title: "Design Ingestion: AI Assistant",
        status: "backlog",
        type: "epic",
        priority: "p1",
        metadata: { type: "ingestion", source: "project_creation" },
      }),
    );

    expect(coreWorkflowClient.requestWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "design_ingestion_new_project",
        input: expect.objectContaining({
          projectName: "AI Assistant",
          files: ["design.png"],
          urls: ["https://example.com/spec"],
        }),
        launch_source: "project_creation",
        context: expect.objectContaining({
          scopeId: "project-ingestion",
          contextType: "work_item",
        }),
      }),
    );
  });

  it("does not trigger ingestion workflow when ingestionInputs is absent", async () => {
    repository.save.mockResolvedValue(
      buildProjectEntity({ id: "project-plain", name: "Plain Project" }),
    );
    goals.create.mockResolvedValue(undefined);

    await service.create({ name: "Plain Project" });

    expect(coreWorkflowClient.requestWorkflowRun).not.toHaveBeenCalled();
    expect(workItems.save).not.toHaveBeenCalled();
  });

  it("launches project_charter_ceo when startOnboarding is true", async () => {
    repository.save.mockResolvedValue(
      buildProjectEntity({ id: "project-onboarding", name: "Test Project" }),
    );
    goals.create.mockResolvedValue(undefined);
    coreWorkflowClient.requestWorkflowRun.mockResolvedValueOnce({
      run_id: "run-abc",
      workflow_id: "project_charter_ceo",
      status: "accepted",
      accepted_at: "2026-06-08T00:00:00.000Z",
      metadata: { correlation_id: "corr-1" },
    });

    const result = await service.create({
      name: "Test Project",
      startOnboarding: true,
    });

    expect(coreWorkflowClient.requestWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "project_charter_ceo",
        input: { mode: "greenfield" },
      }),
    );
    expect(result.onboardingRunId).toBeDefined();
  });

  it("routes charter onboarding to brownfield when the project is created from an imported repo", async () => {
    repository.save.mockResolvedValue(
      buildProjectEntity({
        id: "project-brownfield",
        name: "Imported Project",
      }),
    );
    goals.create.mockResolvedValue(undefined);
    coreWorkflowClient.requestWorkflowRun.mockResolvedValue({
      run_id: "run-bf",
      workflow_id: "project_charter_ceo",
      status: "accepted",
      accepted_at: "2026-06-08T00:00:00.000Z",
      metadata: { correlation_id: "corr-bf" },
    });

    await service.create({
      name: "Imported Project",
      startOnboarding: true,
      ingestionInputs: { files: ["design.png"], urls: [] },
    });

    expect(coreWorkflowClient.requestWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "project_charter_ceo",
        input: { mode: "brownfield" },
      }),
    );
  });

  describe("orchestration settings", () => {
    it("returns empty settings when none persisted", async () => {
      repository.findById.mockResolvedValue(
        buildProjectEntity({
          id: "project-1",
          orchestration_settings: null,
        }),
      );

      const settings = await service.getOrchestrationSettings("project-1");

      expect(settings).toEqual({});
    });

    it("returns parsed settings when project has them", async () => {
      repository.findById.mockResolvedValue(
        buildProjectEntity({
          id: "project-1",
          orchestration_settings: { wakePolicy: "slot_freed" },
        }),
      );

      const settings = await service.getOrchestrationSettings("project-1");

      expect(settings).toEqual({ wakePolicy: "slot_freed" });
    });

    it("getOrchestrationSettings throws NotFoundException for missing project", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.getOrchestrationSettings("missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("merges and persists a wakePolicy override", async () => {
      const project = buildProjectEntity({
        id: "project-1",
        orchestration_settings: {},
      });
      repository.findById.mockResolvedValue(project);
      repository.save.mockImplementation((p: unknown) => Promise.resolve(p));

      const result = await service.updateOrchestrationSettings("project-1", {
        wakePolicy: "every_terminal",
      });

      expect(result).toEqual({ wakePolicy: "every_terminal" });
      expect(project.orchestration_settings).toEqual({
        wakePolicy: "every_terminal",
      });
      expect(repository.save).toHaveBeenCalled();
    });

    it("updateOrchestrationSettings throws NotFoundException for missing project", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.updateOrchestrationSettings("missing", {
          wakePolicy: "slot_freed",
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("updateOrchestrationSettings throws BadRequestException for invalid wakePolicy", async () => {
      repository.findById.mockResolvedValue(
        buildProjectEntity({ id: "project-1" }),
      );

      await expect(
        service.updateOrchestrationSettings("project-1", {
          wakePolicy: "invalid_policy" as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
