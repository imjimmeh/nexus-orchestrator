import { spawn } from "node:child_process";
import { AuditLogger } from "../security/audit-logger.js";
import { CommandAllowlist } from "../security/command-allowlist.js";
import { PathValidator } from "../security/path-validator.js";
import type {
  CommandExecutionInput,
  LocalAgentConfig,
} from "../config/config.types.js";
import type { ToolResult } from "./tools.types.js";

function buildCommandPreview(command: string, args: string[]): string {
  return [command, ...args].join(" ").trim();
}

export class ExecTool {
  private readonly allowlist: CommandAllowlist;

  constructor(
    private readonly config: LocalAgentConfig,
    private readonly pathValidator: PathValidator,
    private readonly auditLogger: AuditLogger,
  ) {
    this.allowlist = new CommandAllowlist(config.allowPatterns);
  }

  async execute(input: CommandExecutionInput): Promise<ToolResult> {
    const args = input.args ?? [];
    const commandPreview = buildCommandPreview(input.command, args);

    if (!this.allowlist.isAllowed(input.command, args)) {
      await this.auditLogger.logFailure("exec", {
        command: commandPreview,
        reason: "command_not_allowlisted",
      });

      return {
        content: [
          { type: "text", text: `Denied by allowlist: ${commandPreview}` },
        ],
        isError: true,
      };
    }

    const cwd = this.pathValidator.resolvePath(input.cwd ?? ".", process.cwd());
    const timeoutMs = input.timeout ?? this.config.defaultCommandTimeoutMs;

    const result = await this.runCommand(input.command, args, cwd, timeoutMs);

    if (result.exitCode === 0) {
      await this.auditLogger.logSuccess("exec", {
        command: commandPreview,
        cwd,
        timeoutMs,
      });

      return {
        content: [{ type: "text", text: result.stdout }],
      };
    }

    await this.auditLogger.logFailure("exec", {
      command: commandPreview,
      cwd,
      timeoutMs,
      exitCode: result.exitCode,
      stderr: result.stderr,
    });

    return {
      content: [
        {
          type: "text",
          text: result.stderr.length > 0 ? result.stderr : result.stdout,
        },
      ],
      isError: true,
    };
  }

  private runCommand(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
      }, timeoutMs);

      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr: error.message, exitCode: 1 });
      });
    });
  }
}
