import fs from "node:fs/promises";
import path from "node:path";
import { AuditLogger } from "../security/audit-logger.js";
import { PathValidator } from "../security/path-validator.js";
import type {
  DeleteInput,
  LsInput,
  ReadFileInput,
  WriteFileInput,
  LocalAgentConfig,
} from "../config/config.types.js";
import type { ToolResult } from "./tools.types.js";

function resultText(text: string, isError = false): ToolResult {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export class FileTools {
  constructor(
    private readonly config: LocalAgentConfig,
    private readonly pathValidator: PathValidator,
    private readonly auditLogger: AuditLogger,
  ) {}

  async readFile(input: ReadFileInput): Promise<ToolResult> {
    const resolved = this.pathValidator.resolvePath(input.path, process.cwd());
    const stat = await fs.stat(resolved);

    if (stat.isDirectory()) {
      const payload = {
        error: "is_directory",
        path: resolved,
        suggestion: "use ls",
      };
      await this.auditLogger.logSuccess("read_file", {
        path: resolved,
        skipped: "is_directory",
      });
      return resultText(JSON.stringify(payload), true);
    }

    const buffer = await fs.readFile(resolved);

    if (buffer.byteLength > this.config.maxFileBytes) {
      return resultText("File exceeds configured maxFileBytes", true);
    }

    const encoding = input.encoding ?? "utf8";
    const value =
      encoding === "base64"
        ? buffer.toString("base64")
        : buffer.toString("utf8");

    await this.auditLogger.logSuccess("read_file", {
      path: resolved,
      encoding,
      bytes: buffer.byteLength,
    });

    return resultText(value);
  }

  async writeFile(input: WriteFileInput): Promise<ToolResult> {
    const resolved = this.pathValidator.resolvePath(input.path, process.cwd());
    const bytes = Buffer.byteLength(input.content, "utf8");

    if (bytes > this.config.maxFileBytes) {
      return resultText("Content exceeds configured maxFileBytes", true);
    }

    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, input.content, {
      encoding: "utf8",
      ...(typeof input.mode === "number" ? { mode: input.mode } : {}),
    });

    await this.auditLogger.logSuccess("write_file", {
      path: resolved,
      bytes,
    });

    return resultText("ok");
  }

  async ls(input: LsInput): Promise<ToolResult> {
    const resolved = this.pathValidator.resolvePath(input.path, process.cwd());
    const recursive = input.recursive ?? false;
    let entries: string[];

    try {
      entries = await this.listEntries(resolved, recursive);
    } catch (error) {
      if (!input.missing_ok || !isMissingPathError(error)) {
        throw error;
      }

      entries = [];
    }

    await this.auditLogger.logSuccess("ls", {
      path: resolved,
      recursive,
      missing_ok: input.missing_ok ?? false,
      count: entries.length,
    });

    return resultText(JSON.stringify(entries, null, 2));
  }

  async delete(input: DeleteInput): Promise<ToolResult> {
    const resolved = this.pathValidator.resolvePath(input.path, process.cwd());
    const recursive = input.recursive ?? false;

    const stat = await fs.lstat(resolved);

    if (stat.isDirectory()) {
      await fs.rm(resolved, {
        recursive,
        force: true,
      });
    } else {
      await fs.unlink(resolved);
    }

    await this.auditLogger.logSuccess("delete", {
      path: resolved,
      recursive,
      isDirectory: stat.isDirectory(),
    });

    return resultText("ok");
  }

  private async listEntries(
    dirPath: string,
    recursive: boolean,
    prefix = "",
  ): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dirPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const relative =
        prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
      results.push(relative);

      if (recursive && entry.isDirectory()) {
        const nestedPath = path.resolve(dirPath, entry.name);
        const nested = await this.listEntries(nestedPath, true, relative);
        results.push(...nested);
      }
    }

    return results;
  }
}
