import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitCommandResult } from './git-command.types';

const execFileAsync = promisify(execFile);

@Injectable()
export class GitCommandService {
  private readonly logger = new Logger(GitCommandService.name);
  private readonly failureDetailMaxLength = 500;

  async exec(
    repoPath: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<GitCommandResult> {
    const mergedEnv = env ? this.mergeEnv(env) : undefined;
    try {
      return await execFileAsync('git', ['-C', repoPath, ...args], {
        env: mergedEnv,
      });
    } catch (error) {
      const message = this.buildFailureMessage(error);
      this.logger.warn(
        `Git command failed: git -C ${repoPath} ${args.join(' ')} (${message})`,
      );
      throw new InternalServerErrorException(
        `Git command failed: git ${args.join(' ')} (${message})`,
      );
    }
  }

  async execLines(
    repoPath: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<string[]> {
    const { stdout } = await this.exec(repoPath, args, env);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Merge caller-supplied env entries over the parent process
   * environment. The merge is non-destructive — entries already
   * on `process.env` are preserved unless explicitly overridden
   * by the caller. This keeps the behaviour compatible with
   * callers that previously relied on the implicit
   * `process.env` inheritance, while still letting credential
   * injection (e.g. `GIT_CONFIG_*`, `GIT_SSH_COMMAND`,
   * `GIT_TERMINAL_PROMPT=0`) take effect for a single
   * invocation.
   */
  private mergeEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const merged: NodeJS.ProcessEnv = { ...process.env };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        continue;
      }
      merged[key] = value;
    }
    return merged;
  }

  private buildFailureMessage(error: unknown): string {
    const record = error as {
      message?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    const primary =
      typeof record?.stderr === 'string' && record.stderr.trim().length > 0
        ? record.stderr
        : typeof record?.message === 'string'
          ? record.message
          : 'unknown git error';
    const secondary =
      typeof record?.stdout === 'string' && record.stdout.trim().length > 0
        ? ` | stdout: ${record.stdout.trim()}`
        : '';
    return `${primary.trim()}${secondary}`.slice(
      0,
      this.failureDetailMaxLength,
    );
  }
}
