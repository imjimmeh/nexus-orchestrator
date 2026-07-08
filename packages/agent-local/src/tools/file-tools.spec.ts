import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../security/audit-logger.js";
import { PathValidator } from "../security/path-validator.js";
import type { LocalAgentConfig } from "../config/config.types.js";
import { FileTools } from "./file-tools.js";

function buildConfig(allowedRoot: string): LocalAgentConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    allowedRoots: [allowedRoot],
    allowPatterns: [],
    defaultCommandTimeoutMs: 1000,
    maxFileBytes: 1024 * 1024,
    logToStdout: false,
  };
}

describe("FileTools.readFile", () => {
  let workspace: string;
  let originalCwd: string;
  let tools: FileTools;

  beforeEach(async () => {
    originalCwd = process.cwd();
    workspace = await fs.mkdtemp(
      path.join(os.tmpdir(), "agent-local-file-tools-"),
    );
    process.chdir(workspace);
    const validator = new PathValidator([workspace]);
    const auditLogger = new AuditLogger(false);
    tools = new FileTools(buildConfig(workspace), validator, auditLogger);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("returns file contents for a regular file", async () => {
    const filePath = path.join(workspace, "note.txt");
    await fs.writeFile(filePath, "hello world", "utf8");

    const result = await tools.readFile({ path: "note.txt" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({ type: "text", text: "hello world" });
  });

  it("returns an is_directory error when the path resolves to a directory", async () => {
    const dirPath = path.join(workspace, "subdir");
    await fs.mkdir(dirPath);

    const result = await tools.readFile({ path: "subdir" });

    expect(result.isError).toBe(true);
    const [first] = result.content;
    const payload = JSON.parse(first.text) as {
      error: string;
      suggestion: string;
      path: string;
    };
    expect(payload.error).toBe("is_directory");
    expect(payload.suggestion).toBe("use ls");
    expect(payload.path).toBe(dirPath);
  });

  it("returns an empty successful listing when a missing ls path allows missing_ok", async () => {
    const result = await tools.ls({ path: "missing-dir", missing_ok: true });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({ type: "text", text: "[]" });
  });
});
