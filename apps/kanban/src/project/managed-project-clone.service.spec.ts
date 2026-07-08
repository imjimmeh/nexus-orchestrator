import path from "node:path";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import type { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";
import {
  ManagedProjectCloneService,
  resolveManagedClonePath,
} from "./managed-project-clone.service";

const project_id = "123e4567-e89b-12d3-a456-426614174000";
const WORKSPACE_BASE_PATH = path.resolve("/nexus-workspace");

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_file, _args, optionsOrCallback, maybeCallback) => {
    const callback =
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : maybeCallback;
    callback(null, { stdout: "", stderr: "" });
  }),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

function expectGitCloneInvokedSafely(
  repositoryUrl: string,
  targetPath: string,
): void {
  expect(execFile).toHaveBeenCalledWith(
    "git",
    ["clone", "--", repositoryUrl, targetPath],
    expect.objectContaining({
      env: expect.objectContaining({
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
        GIT_SSH_COMMAND: "ssh -oBatchMode=yes -oStrictHostKeyChecking=yes",
      }),
      timeout: expect.any(Number),
      maxBuffer: expect.any(Number),
    }),
    expect.any(Function),
  );

  const options = vi.mocked(execFile).mock.calls[0]?.[2] as {
    timeout: number;
    maxBuffer: number;
  };
  expect(options.timeout).toBeGreaterThan(0);
  expect(options.maxBuffer).toBeGreaterThan(1024 * 1024);
}

type MockProjectRepository = {
  findById: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
};

type MockCoreWorkflowClient = {
  emitEventLedger: ReturnType<typeof vi.fn>;
  retrieveSecret: ReturnType<typeof vi.fn>;
  refreshRepositoryWorkflows: ReturnType<typeof vi.fn>;
};

function buildProject(
  overrides: Partial<{
    id: string;
    name: string;
    repository_url: string | null;
    base_path: string | null;
    source_type: string;
    github_secret_id: string | null;
  }> = {},
) {
  const repositoryUrl = Object.hasOwn(overrides, "repository_url")
    ? overrides.repository_url
    : "https://github.com/org/repo.git";

  return {
    id: overrides.id ?? project_id,
    name: overrides.name ?? "Remote project",
    repository_url: repositoryUrl,
    base_path: overrides.base_path ?? null,
    goals: null,
    github_secret_id: overrides.github_secret_id ?? null,
    description: null,
    source_type: overrides.source_type ?? "import_remote",
    copy_to_workspace: true,
    allow_host_mounts: null,
    deny_host_mounts: null,
    allow_host_mount_rw: null,
    created_at: new Date("2026-04-30T00:00:00.000Z"),
    updated_at: new Date("2026-04-30T00:00:01.000Z"),
  };
}

describe("resolveManagedClonePath", () => {
  it("resolves project clone paths under the managed workspace clone directory", () => {
    expect(resolveManagedClonePath("/nexus-workspace", project_id)).toBe(
      path.join(path.resolve("/nexus-workspace"), "clones", project_id),
    );
  });
});

describe("ManagedProjectCloneService", () => {
  let repository: MockProjectRepository;
  let core: MockCoreWorkflowClient;
  let service: ManagedProjectCloneService;
  let originalWorkspaceBasePath: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalWorkspaceBasePath = process.env.NEXUS_WORKSPACE_BASE_PATH;
    process.env.NEXUS_WORKSPACE_BASE_PATH = WORKSPACE_BASE_PATH;
    repository = {
      findById: vi.fn(),
      save: vi.fn(),
    };
    core = {
      emitEventLedger: vi.fn().mockResolvedValue(undefined),
      retrieveSecret: vi.fn().mockResolvedValue(undefined),
      refreshRepositoryWorkflows: vi.fn().mockResolvedValue(undefined),
    };
    service = new ManagedProjectCloneService(
      repository as unknown as KanbanProjectRepository,
      core as unknown as CoreWorkflowClientService,
    );
  });

  afterEach(() => {
    if (originalWorkspaceBasePath === undefined) {
      delete process.env.NEXUS_WORKSPACE_BASE_PATH;
      return;
    }
    process.env.NEXUS_WORKSPACE_BASE_PATH = originalWorkspaceBasePath;
  });

  it("clones a remote project into the managed workspace and emits Core git audit events", async () => {
    const project = buildProject({ id: project_id });
    const targetPath = path.join(WORKSPACE_BASE_PATH, "clones", project_id);
    repository.findById.mockResolvedValue(project);
    repository.save.mockResolvedValue({ ...project, base_path: targetPath });

    const cloned = await service.cloneRemoteProject(project_id);

    expect(core.emitEventLedger).toHaveBeenNthCalledWith(1, {
      domain: "git",
      eventName: "git.clone.requested",
      outcome: "in_progress",
      source: "kanban.managed-project-clone",
      actorType: "system",
      project_id: project_id,
      payload: {
        repositoryUrl: "https://github.com/org/repo.git",
        targetPath,
        hasAuth: false,
      },
    });
    expectGitCloneInvokedSafely("https://github.com/org/repo.git", targetPath);
    expect(repository.save).toHaveBeenCalledWith({
      id: project_id,
      base_path: targetPath,
    });
    expect(core.emitEventLedger).toHaveBeenNthCalledWith(2, {
      domain: "git",
      eventName: "git.clone.succeeded",
      outcome: "success",
      source: "kanban.managed-project-clone",
      actorType: "system",
      project_id: project_id,
      payload: {
        repositoryUrl: "https://github.com/org/repo.git",
        targetPath,
        hasAuth: false,
      },
    });
    expect(cloned).toEqual(
      expect.objectContaining({
        id: project_id,
        base_path: targetPath,
      }),
    );
  });

  it("clones private repo using token from github_secret_id", async () => {
    const repositoryUrl = "https://github.com/org/private-repo.git";
    const project = buildProject({
      id: project_id,
      repository_url: repositoryUrl,
      github_secret_id: "secret-id-123",
    });
    const targetPath = path.join(WORKSPACE_BASE_PATH, "clones", project_id);
    repository.findById.mockResolvedValue(project);
    repository.save.mockResolvedValue({ ...project, base_path: targetPath });
    core.retrieveSecret.mockResolvedValue("ghp_testtoken123456");

    await service.cloneRemoteProject(project_id);

    expect(core.retrieveSecret).toHaveBeenCalledWith("secret-id-123");
    expectGitCloneInvokedSafely(
      "https://ghp_testtoken123456:x-oauth-basic@github.com/org/private-repo.git",
      targetPath,
    );
    expect(core.emitEventLedger).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: expect.objectContaining({
          repositoryUrl: "https://github.com/org/private-repo.git",
          targetPath,
          hasAuth: true,
        }),
      }),
    );
  });

  it("attempts clone without token when github_secret_id is null", async () => {
    const project = buildProject({ id: project_id, github_secret_id: null });
    const targetPath = path.join(WORKSPACE_BASE_PATH, "clones", project_id);
    repository.findById.mockResolvedValue(project);
    repository.save.mockResolvedValue({ ...project, base_path: targetPath });

    await service.cloneRemoteProject(project_id);

    expect(core.retrieveSecret).not.toHaveBeenCalled();
    expectGitCloneInvokedSafely("https://github.com/org/repo.git", targetPath);
    expect(core.emitEventLedger).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: expect.objectContaining({
          hasAuth: false,
        }),
      }),
    );
  });

  it("fails before unauthenticated clone when configured GitHub secret cannot be retrieved", async () => {
    const project = buildProject({
      id: project_id,
      github_secret_id: "bad-secret-id",
    });
    const targetPath = path.join(WORKSPACE_BASE_PATH, "clones", project_id);
    repository.findById.mockResolvedValue(project);
    core.retrieveSecret.mockRejectedValue(new Error("Secret not found"));

    await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
      "GitHub secret bad-secret-id could not be retrieved for project 123e4567-e89b-12d3-a456-426614174000: Secret not found",
    );

    expect(core.retrieveSecret).toHaveBeenCalledWith("bad-secret-id");
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(core.emitEventLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "git.clone.failed",
        errorMessage:
          "GitHub secret bad-secret-id could not be retrieved for project 123e4567-e89b-12d3-a456-426614174000: Secret not found",
        payload: expect.objectContaining({
          targetPath,
          hasAuth: false,
        }),
      }),
    );
  });

  it("logs meaningful git error message on clone failure", async () => {
    const project = buildProject({ id: project_id });
    const targetPath = path.join(WORKSPACE_BASE_PATH, "clones", project_id);
    const cloneError = Object.assign(new Error("Command failed: git clone"), {
      code: 128,
      stderr: "remote: Repository not found.\nfatal: repository not found",
      stdout: "",
    });
    const logSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    repository.findById.mockResolvedValue(project);
    vi.mocked(execFile).mockImplementationOnce(
      (_file, _args, optionsOrCallback, maybeCallback) => {
        const callback =
          typeof optionsOrCallback === "function"
            ? optionsOrCallback
            : maybeCallback;
        callback(cloneError, {
          stdout: "",
          stderr: "remote: Repository not found.\nfatal: repository not found",
        });
      },
    );

    expect(() => {
      service.startClone(project_id);
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(core.emitEventLedger).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "git.clone.failed",
        }),
      );
    });

    expect(core.emitEventLedger).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventName: "git.clone.failed",
        errorMessage:
          "remote: Repository not found.\nfatal: repository not found",
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "remote: Repository not found.\nfatal: repository not found",
      ),
    );
    logSpy.mockRestore();
  });

  it("redacts token from git error messages", async () => {
    const project = buildProject({
      id: project_id,
      github_secret_id: "secret-id-123",
    });
    const targetPath = path.join(WORKSPACE_BASE_PATH, "clones", project_id);
    const cloneError = Object.assign(new Error("Command failed: git clone"), {
      code: 128,
      stderr:
        "remote: token ghp_1234567890abcdef1234567890abcdef1234 was rejected",
      stdout: "",
    });
    const logSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    repository.findById.mockResolvedValue(project);
    core.retrieveSecret.mockResolvedValue(
      "ghp_1234567890abcdef1234567890abcdef1234",
    );
    vi.mocked(execFile).mockImplementationOnce(
      (_file, _args, optionsOrCallback, maybeCallback) => {
        const callback =
          typeof optionsOrCallback === "function"
            ? optionsOrCallback
            : maybeCallback;
        callback(cloneError, {
          stdout: "",
          stderr:
            "remote: token ghp_1234567890abcdef1234567890abcdef1234 was rejected",
        });
      },
    );

    expect(() => {
      service.startClone(project_id);
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(core.emitEventLedger).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "git.clone.failed",
        }),
      );
    });

    const emittedPayload = JSON.stringify(core.emitEventLedger.mock.calls);
    expect(emittedPayload).not.toContain(
      "ghp_1234567890abcdef1234567890abcdef1234",
    );
    expect(emittedPayload).toContain("[REDACTED_TOKEN]");
    const logOutput = JSON.stringify(logSpy.mock.calls);
    expect(logOutput).not.toContain("ghp_1234567890abcdef1234567890abcdef1234");
    logSpy.mockRestore();
  });

  it("creates the managed clone root before invoking git clone", async () => {
    const project = buildProject({ id: project_id });
    const targetPath = path.join(WORKSPACE_BASE_PATH, "clones", project_id);
    repository.findById.mockResolvedValue(project);
    repository.save.mockResolvedValue({ ...project, base_path: targetPath });
    const callOrder: string[] = [];
    vi.mocked(mkdir).mockImplementationOnce(() => {
      callOrder.push("mkdir");
      return Promise.resolve(undefined);
    });
    vi.mocked(execFile).mockImplementationOnce(
      (_file, _args, optionsOrCallback, maybeCallback) => {
        callOrder.push("git");
        const callback =
          typeof optionsOrCallback === "function"
            ? optionsOrCallback
            : maybeCallback;
        callback(null, { stdout: "", stderr: "" });
      },
    );

    await service.cloneRemoteProject(project_id);

    expect(mkdir).toHaveBeenCalledWith(path.dirname(targetPath), {
      recursive: true,
    });
    expect(callOrder).toEqual(["mkdir", "git"]);
  });

  it("clones SCP-style SSH remotes that match the safe allowlist", async () => {
    const repositoryUrl = "git@github.com:org/repo.git";
    const project = buildProject({
      id: project_id,
      repository_url: repositoryUrl,
    });
    const targetPath = path.join(WORKSPACE_BASE_PATH, "clones", project_id);
    repository.findById.mockResolvedValue(project);
    repository.save.mockResolvedValue({ ...project, base_path: targetPath });

    await service.cloneRemoteProject(project_id);

    expectGitCloneInvokedSafely(repositoryUrl, targetPath);
    expect(core.emitEventLedger).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: {
          repositoryUrl,
          targetPath,
          hasAuth: false,
        },
      }),
    );
  });

  it("emits a redacted failure event without updating base_path or throwing from the async clone path", async () => {
    const project = buildProject({ id: project_id });
    const targetPath = path.join(WORKSPACE_BASE_PATH, "clones", project_id);
    const secretOutput =
      "remote: token ghp_1234567890abcdef1234567890abcdef1234 was rejected";
    const cloneError = Object.assign(new Error("Command failed: git clone"), {
      code: 128,
      stderr: secretOutput,
      stdout: "",
    });
    const logSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    repository.findById.mockResolvedValue(project);
    vi.mocked(execFile).mockImplementationOnce(
      (_file, _args, optionsOrCallback, maybeCallback) => {
        const callback =
          typeof optionsOrCallback === "function"
            ? optionsOrCallback
            : maybeCallback;
        callback(cloneError, { stdout: "", stderr: secretOutput });
      },
    );

    expect(() => {
      service.startClone(project_id);
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(core.emitEventLedger).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "git.clone.failed",
        }),
      );
    });

    expect(repository.save).not.toHaveBeenCalled();
    expect(core.emitEventLedger).toHaveBeenNthCalledWith(2, {
      domain: "git",
      eventName: "git.clone.failed",
      outcome: "failure",
      source: "kanban.managed-project-clone",
      actorType: "system",
      project_id: project_id,
      errorCode: "128",
      errorMessage: "remote: token [REDACTED_TOKEN] was rejected",
      payload: {
        repositoryUrl: "https://github.com/org/repo.git",
        targetPath,
        hasAuth: false,
      },
    });
    expect(JSON.stringify(core.emitEventLedger.mock.calls)).not.toContain(
      "ghp_1234567890abcdef1234567890abcdef1234",
    );
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain("ghp_secret_token");
    logSpy.mockRestore();
  });

  it("emits a redacted failure event when saving the managed clone base_path fails", async () => {
    const project = buildProject({ id: project_id });
    const targetPath = path.join(WORKSPACE_BASE_PATH, "clones", project_id);
    const secretOutput =
      "database rejected token ghp_1234567890abcdef1234567890abcdef1234 in stack trace";
    const saveError = Object.assign(new Error(secretOutput), {
      code: "23505",
    });
    const logSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    repository.findById.mockResolvedValue(project);
    repository.save.mockRejectedValue(saveError);

    expect(() => {
      service.startClone(project_id);
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(core.emitEventLedger).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "git.clone.failed",
        }),
      );
    });

    expect(core.emitEventLedger).toHaveBeenNthCalledWith(2, {
      domain: "git",
      eventName: "git.clone.failed",
      outcome: "failure",
      source: "kanban.managed-project-clone",
      actorType: "system",
      project_id: project_id,
      errorCode: "23505",
      errorMessage: "database rejected token [REDACTED_TOKEN] in stack trace",
      payload: {
        repositoryUrl: "https://github.com/org/repo.git",
        targetPath,
        hasAuth: false,
      },
    });
    expect(core.emitEventLedger).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "git.clone.succeeded",
      }),
    );
    const emittedEvents = JSON.stringify(core.emitEventLedger.mock.calls);
    expect(emittedEvents).not.toContain(
      "ghp_1234567890abcdef1234567890abcdef1234",
    );
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(
      "ghp_1234567890abcdef1234567890abcdef1234",
    );
    logSpy.mockRestore();
  });

  it("logs sanitized pre-audit background failures without throwing synchronously", async () => {
    process.env.NEXUS_WORKSPACE_BASE_PATH =
      "relative-workspace-ghp_secret_token";
    const logSpy = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    repository.findById.mockResolvedValue(buildProject());

    expect(() => {
      service.startClone(project_id);
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(logSpy).toHaveBeenCalled();
    });

    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    const logOutput = JSON.stringify(logSpy.mock.calls);
    expect(logOutput).toContain(project_id);
    expect(logOutput).not.toContain("relative-workspace-ghp_secret_token");
    expect(logOutput).not.toContain(
      "NEXUS_WORKSPACE_BASE_PATH must be an absolute path",
    );
    expect(logOutput).not.toContain("https://github.com/org/repo.git");
    logSpy.mockRestore();
  });

  it("rejects credential-bearing HTTPS repository URLs before emitting audit events or invoking git", async () => {
    repository.findById.mockResolvedValue(
      buildProject({
        repository_url: "https://token:secret@github.com/org/repo.git",
      }),
    );

    await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
      "Repository URL must not include credentials",
    );

    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects repository URLs with query strings before emitting audit events or invoking git", async () => {
    repository.findById.mockResolvedValue(
      buildProject({
        repository_url: "https://github.com/org/repo.git?token=secret",
      }),
    );

    await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
      "Repository URL must not include credentials, query strings, or fragments",
    );

    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects repository URLs with fragments before emitting audit events or invoking git", async () => {
    repository.findById.mockResolvedValue(
      buildProject({
        repository_url: "https://github.com/org/repo.git#secret",
      }),
    );

    await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
      "Repository URL must not include credentials, query strings, or fragments",
    );

    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects SCP-style remotes with query strings before emitting audit events or invoking git", async () => {
    repository.findById.mockResolvedValue(
      buildProject({
        repository_url: "git@github.com:org/repo.git?token=secret",
      }),
    );

    await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
      "Repository URL must not include credentials, query strings, or fragments",
    );

    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects SCP-style remotes with fragments before emitting audit events or invoking git", async () => {
    repository.findById.mockResolvedValue(
      buildProject({
        repository_url: "git@github.com:org/repo.git#secret",
      }),
    );

    await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
      "Repository URL must not include credentials, query strings, or fragments",
    );

    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it.each([
    [
      "malformed credential-bearing non-URL input",
      "github.com/token:secret@org/repo.git",
    ],
    ["local relative repository input", "org/repo.git"],
    ["local absolute repository input", "G:\\repos\\repo.git"],
    ["file repository input", "file:///G:/repos/repo.git"],
    ["unsupported HTTP scheme", "http://github.com/org/repo.git"],
  ])(
    "rejects %s before emitting audit events or invoking git",
    async (_caseName, repositoryUrl) => {
      repository.findById.mockResolvedValue(
        buildProject({ repository_url: repositoryUrl }),
      );

      await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
        "Repository URL must be an HTTPS URL or SCP-style SSH remote",
      );

      expect(core.emitEventLedger).not.toHaveBeenCalled();
      expect(execFile).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it("rejects path-like project IDs before invoking git", async () => {
    await expect(service.cloneRemoteProject("../repo")).rejects.toThrow(
      "Project ID must be a UUID",
    );

    expect(repository.findById).not.toHaveBeenCalled();
    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when the project is missing", async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.cloneRemoteProject(project_id)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects missing repository URLs before emitting audit events or invoking git", async () => {
    repository.findById.mockResolvedValue(
      buildProject({ repository_url: null }),
    );

    await expect(service.cloneRemoteProject(project_id)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects local projects before creating directories, emitting events, invoking git, or saving", async () => {
    repository.findById.mockResolvedValue(
      buildProject({ source_type: "local" }),
    );

    await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
      "Only import_remote projects can be managed-cloned",
    );

    expect(mkdir).not.toHaveBeenCalled();
    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects remote import projects with an existing base_path before creating directories, emitting events, invoking git, or saving", async () => {
    repository.findById.mockResolvedValue(
      buildProject({ base_path: "G:\\existing\\repo" }),
    );

    await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
      "Project base_path must be blank before managed clone",
    );

    expect(mkdir).not.toHaveBeenCalled();
    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects blank repository URLs before emitting audit events or invoking git", async () => {
    repository.findById.mockResolvedValue(
      buildProject({ repository_url: "  " }),
    );

    await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
      "Project repository URL is required",
    );

    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects blank workspace base paths before emitting audit events or invoking git", async () => {
    process.env.NEXUS_WORKSPACE_BASE_PATH = "  ";
    repository.findById.mockResolvedValue(buildProject());

    await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
      "NEXUS_WORKSPACE_BASE_PATH must be an absolute path",
    );

    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects relative workspace base paths before emitting audit events or invoking git", async () => {
    process.env.NEXUS_WORKSPACE_BASE_PATH = "relative-workspace";
    repository.findById.mockResolvedValue(buildProject());

    await expect(service.cloneRemoteProject(project_id)).rejects.toThrow(
      "NEXUS_WORKSPACE_BASE_PATH must be an absolute path",
    );

    expect(core.emitEventLedger).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("triggers repository workflow refresh after successful clone", async () => {
    const project = buildProject({ id: project_id });
    const targetPath = resolveManagedClonePath(WORKSPACE_BASE_PATH, project_id);
    repository.findById.mockResolvedValue(project);
    repository.save.mockResolvedValue({ ...project, base_path: targetPath });

    await service.cloneRemoteProject(project_id);

    expect(core.refreshRepositoryWorkflows).toHaveBeenCalledWith({
      scopeId: project_id,
      rootPath: targetPath,
    });
  });

  it("completes clone successfully even when repository workflow refresh rejects", async () => {
    const project = buildProject({ id: project_id });
    const targetPath = resolveManagedClonePath(WORKSPACE_BASE_PATH, project_id);
    repository.findById.mockResolvedValue(project);
    repository.save.mockResolvedValue({ ...project, base_path: targetPath });
    core.refreshRepositoryWorkflows.mockRejectedValue(
      new Error("Discovery failed"),
    );

    const cloned = await service.cloneRemoteProject(project_id);

    expect(core.refreshRepositoryWorkflows).toHaveBeenCalledWith({
      scopeId: project_id,
      rootPath: targetPath,
    });
    expect(cloned).toEqual(
      expect.objectContaining({
        id: project_id,
        base_path: targetPath,
      }),
    );
  });
});
