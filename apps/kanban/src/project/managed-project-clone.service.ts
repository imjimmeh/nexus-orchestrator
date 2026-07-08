import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { KanbanProjectRepository } from "../database/repositories/kanban-project.repository";

const execFileAsync = promisify(execFile);
const MANAGED_CLONE_EVENT_SOURCE = "kanban.managed-project-clone";
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;
const CLONE_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBVIOUS_NON_URL_CREDENTIAL_PATTERN = /^[^/@\s]+:[^/@\s]+@/;
const SCP_STYLE_SSH_REMOTE_PATTERN =
  /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^/\s?#][^\s?#]*$/;
const UNSAFE_STANDARD_URL_MESSAGE =
  "Repository URL must not include credentials, query strings, or fragments";
const UNSUPPORTED_REMOTE_MESSAGE =
  "Repository URL must be an HTTPS URL or SCP-style SSH remote";
const GIT_CLONE_EXEC_OPTIONS: ExecFileOptions = {
  env: {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GIT_SSH_COMMAND: "ssh -oBatchMode=yes -oStrictHostKeyChecking=yes",
  },
  timeout: CLONE_TIMEOUT_MS,
  maxBuffer: CLONE_MAX_BUFFER_BYTES,
};

type CloneAuditPayload = {
  repositoryUrl: string;
  targetPath: string;
  hasAuth: boolean;
};

export function resolveManagedClonePath(
  workspaceBasePath: string | undefined,
  project_id: string,
): string {
  assertproject_idIsUuid(project_id);
  const cloneRoot = resolveManagedCloneRoot(workspaceBasePath);
  const targetPath = path.resolve(cloneRoot, project_id);
  assertPathIsUnderCloneRoot(cloneRoot, targetPath);
  return targetPath;
}

function resolveManagedCloneRoot(
  workspaceBasePath: string | undefined,
): string {
  const trimmedWorkspaceBasePath = workspaceBasePath?.trim();
  if (!trimmedWorkspaceBasePath || !path.isAbsolute(trimmedWorkspaceBasePath)) {
    throw new BadRequestException(
      "NEXUS_WORKSPACE_BASE_PATH must be an absolute path",
    );
  }

  return path.resolve(trimmedWorkspaceBasePath, "clones");
}

function assertPathIsUnderCloneRoot(
  cloneRoot: string,
  targetPath: string,
): void {
  const relativeTargetPath = path.relative(cloneRoot, targetPath);
  if (
    relativeTargetPath.startsWith("..") ||
    path.isAbsolute(relativeTargetPath)
  ) {
    throw new BadRequestException(
      "Managed clone path must stay under clone root",
    );
  }
}

function assertproject_idIsUuid(project_id: string): void {
  if (!UUID_PATTERN.test(project_id)) {
    throw new BadRequestException("Project ID must be a UUID");
  }
}

export function assertRepositoryUrlIsSafeRemote(repositoryUrl: string): void {
  try {
    const url = new URL(repositoryUrl);
    if (url.username || url.password || url.search || url.hash) {
      throw new BadRequestException(UNSAFE_STANDARD_URL_MESSAGE);
    }
    if (url.protocol !== "https:" || !url.hostname) {
      throw new BadRequestException(UNSUPPORTED_REMOTE_MESSAGE);
    }
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    if (repositoryUrl.includes("?") || repositoryUrl.includes("#")) {
      throw new BadRequestException(UNSAFE_STANDARD_URL_MESSAGE);
    }
    if (OBVIOUS_NON_URL_CREDENTIAL_PATTERN.test(repositoryUrl)) {
      throw new BadRequestException(
        "Repository URL must not include credentials",
      );
    }
    if (!SCP_STYLE_SSH_REMOTE_PATTERN.test(repositoryUrl)) {
      throw new BadRequestException(UNSUPPORTED_REMOTE_MESSAGE);
    }
  }
}

@Injectable()
export class ManagedProjectCloneService {
  private readonly logger = new Logger(ManagedProjectCloneService.name);

  constructor(
    private readonly projects: KanbanProjectRepository,
    private readonly core: CoreWorkflowClientService,
  ) {}

  startClone(project_id: string): void {
    void this.cloneRemoteProject(project_id).catch((error: unknown) => {
      this.logBackgroundCloneFailure(project_id, error);
    });
  }

  async cloneRemoteProject(project_id: string) {
    assertproject_idIsUuid(project_id);
    const project = await this.projects.findById(project_id);
    if (!project) {
      throw new NotFoundException(`Project ${project_id} not found`);
    }

    if (project.source_type !== "import_remote") {
      throw new BadRequestException(
        "Only import_remote projects can be managed-cloned",
      );
    }

    if (project.base_path?.trim()) {
      throw new BadRequestException(
        "Project base_path must be blank before managed clone",
      );
    }

    const repositoryUrl = project.repository_url?.trim();
    if (!repositoryUrl) {
      throw new BadRequestException("Project repository URL is required");
    }

    assertRepositoryUrlIsSafeRemote(repositoryUrl);

    const workspaceBasePath = process.env.NEXUS_WORKSPACE_BASE_PATH;
    const targetPath = resolveManagedClonePath(workspaceBasePath, project_id);
    const auditPayload = {
      repositoryUrl: this.redactRepositoryUrl(repositoryUrl),
      targetPath,
      hasAuth: false,
    };

    const githubToken = await this.retrieveConfiguredGithubToken(
      project_id,
      project.github_secret_id,
      auditPayload,
    );
    const cloneAuditPayload = { ...auditPayload, hasAuth: !!githubToken };

    await this.core.emitEventLedger({
      domain: "git",
      eventName: "git.clone.requested",
      outcome: "in_progress",
      source: MANAGED_CLONE_EVENT_SOURCE,
      actorType: "system",
      project_id,
      payload: cloneAuditPayload,
    });
    let updated;
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });

      // Build authenticated clone options if token is available
      const cloneOptions = githubToken
        ? this.buildAuthenticatedCloneOptions(repositoryUrl, githubToken)
        : { url: repositoryUrl, env: {} };

      await execFileAsync(
        "git",
        ["clone", "--", cloneOptions.url, targetPath],
        {
          ...GIT_CLONE_EXEC_OPTIONS,
          env: {
            ...GIT_CLONE_EXEC_OPTIONS.env,
            ...cloneOptions.env,
          },
        },
      );
      updated = await this.projects.save({
        id: project_id,
        base_path: targetPath,
      });
      this.core
        .refreshRepositoryWorkflows({
          scopeId: project_id,
          rootPath: targetPath,
        })
        .catch((err: unknown) => {
          this.logger.warn(
            "Repository workflow discovery failed after clone",
            err,
          );
        });
    } catch (error) {
      const errorCode = this.getSafeErrorCode(error);
      const errorMessage = this.extractGitErrorMessage(error);

      await this.core.emitEventLedger({
        domain: "git",
        eventName: "git.clone.failed",
        outcome: "failure",
        source: MANAGED_CLONE_EVENT_SOURCE,
        actorType: "system",
        project_id,
        errorCode,
        errorMessage: errorMessage || "Git clone failed",
        payload: cloneAuditPayload,
      });
      this.logger.error(
        `Git clone failed for project ${project_id}${errorCode ? ` with code ${errorCode}` : ""}: ${errorMessage}`,
      );
      throw error;
    }
    await this.core.emitEventLedger({
      domain: "git",
      eventName: "git.clone.succeeded",
      outcome: "success",
      source: MANAGED_CLONE_EVENT_SOURCE,
      actorType: "system",
      project_id,
      payload: cloneAuditPayload,
    });

    return updated;
  }

  private async retrieveConfiguredGithubToken(
    project_id: string,
    github_secret_id: string | null | undefined,
    auditPayload: CloneAuditPayload,
  ): Promise<string | undefined> {
    if (!github_secret_id) {
      return undefined;
    }

    try {
      const secretValue = await this.core.retrieveSecret(github_secret_id);
      return this.parseGithubToken(secretValue);
    } catch (error) {
      const errorMessage = `GitHub secret ${github_secret_id} could not be retrieved for project ${project_id}: ${error instanceof Error ? error.message : "Unknown error"}`;
      await this.core.emitEventLedger({
        domain: "git",
        eventName: "git.clone.failed",
        outcome: "failure",
        source: MANAGED_CLONE_EVENT_SOURCE,
        actorType: "system",
        project_id,
        errorMessage,
        payload: auditPayload,
      });
      throw new Error(errorMessage, { cause: error });
    }
  }

  private parseGithubToken(secretValue: string): string {
    try {
      const parsed = JSON.parse(secretValue) as Record<string, unknown>;
      return (
        (parsed.github_token as string) ||
        (parsed.token as string) ||
        secretValue
      );
    } catch {
      return secretValue;
    }
  }

  private redactRepositoryUrl(repositoryUrl: string): string {
    try {
      const url = new URL(repositoryUrl);
      url.username = "";
      url.password = "";
      return url.toString();
    } catch {
      return repositoryUrl;
    }
  }

  private getSafeErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object" || !("code" in error)) {
      return undefined;
    }

    const code = error.code;
    if (typeof code === "string" || typeof code === "number") {
      return String(code).slice(0, 32);
    }

    return undefined;
  }

  private buildAuthenticatedCloneOptions(
    repositoryUrl: string,
    token: string,
  ): { url: string; env: Record<string, string> } {
    try {
      const url = new URL(repositoryUrl);
      // Use token as username for HTTPS auth
      url.username = token;
      url.password = "x-oauth-basic";
      return { url: url.toString(), env: {} };
    } catch {
      // For SCP-style URLs, we can't embed credentials easily
      // Fall back to original URL (clone will likely fail for private repos)
      return {
        url: repositoryUrl,
        env: {},
      };
    }
  }

  private extractGitErrorMessage(error: unknown): string | undefined {
    if (!error || typeof error !== "object") {
      return undefined;
    }

    const message = (error as Error).message;
    const stderr = (error as Record<string, unknown>).stderr;

    // Prefer stderr for execFile errors (contains git output), fallback to message
    const rawMessage =
      typeof stderr === "string" && stderr.length > 0
        ? stderr
        : typeof message === "string"
          ? message
          : undefined;

    if (!rawMessage) {
      return undefined;
    }

    // Remove sensitive info (GitHub tokens and similar)
    return rawMessage.replace(/ghp_[a-zA-Z0-9]+/gi, "[REDACTED_TOKEN]");
  }

  private logBackgroundCloneFailure(project_id: string, error: unknown): void {
    const errorCode = this.getSafeErrorCode(error);
    this.logger.error(
      `Managed project clone background task failed for project ${project_id}${errorCode ? ` with code ${errorCode}` : ""}`,
    );
  }
}
