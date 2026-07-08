import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { normalizeOptionalString } from "@nexus/core";
import { ProjectService } from "./project.service";
import type {
  ProjectAgentsDocument,
  UpdateProjectAgentsDocumentInput,
} from "./project-agents-file.service.types";

const AGENTS_FILE_NAME = "AGENTS.md";

@Injectable()
export class ProjectAgentsFileService {
  constructor(private readonly projects: ProjectService) {}

  async getDocument(projectId: string): Promise<ProjectAgentsDocument> {
    const repoPath = await this.requireRepoPath(projectId);
    const absolutePath = path.join(repoPath, AGENTS_FILE_NAME);

    try {
      const [content, metadata] = await Promise.all([
        readFile(absolutePath, "utf8"),
        stat(absolutePath),
      ]);

      return {
        projectId,
        path: AGENTS_FILE_NAME,
        exists: true,
        content,
        etag: this.toEtag(content),
        updatedAt: metadata.mtime.toISOString(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          projectId,
          path: AGENTS_FILE_NAME,
          exists: false,
          content: "",
          etag: null,
          updatedAt: null,
        };
      }

      throw new BadRequestException(this.toErrorMessage(error));
    }
  }

  async updateDocument(
    projectId: string,
    input: UpdateProjectAgentsDocumentInput,
  ): Promise<ProjectAgentsDocument> {
    if (typeof input.content !== "string") {
      throw new BadRequestException("content must be a string");
    }

    const expectedEtag = normalizeOptionalString(input.expected_etag);
    const current = await this.getDocument(projectId);

    if (current.exists && !expectedEtag) {
      throw new ConflictException(
        "expected_etag is required when updating an existing AGENTS.md file",
      );
    }

    if (current.exists && expectedEtag !== current.etag) {
      throw new ConflictException(
        "AGENTS.md has changed since it was last read. Reload and retry.",
      );
    }

    if (!current.exists && expectedEtag) {
      throw new ConflictException(
        "AGENTS.md does not exist at the expected revision. Reload and retry.",
      );
    }

    const repoPath = await this.requireRepoPath(projectId);
    await writeFile(
      path.join(repoPath, AGENTS_FILE_NAME),
      input.content,
      "utf8",
    );
    return this.getDocument(projectId);
  }

  private async requireRepoPath(projectId: string): Promise<string> {
    const project = await this.projects.get(projectId);
    const repoPath = project.basePath?.trim();
    if (!repoPath) {
      throw new BadRequestException("Project base path is not configured");
    }
    return repoPath;
  }

  private toEtag(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return typeof error === "string" ? error : "Unknown error";
  }
}
