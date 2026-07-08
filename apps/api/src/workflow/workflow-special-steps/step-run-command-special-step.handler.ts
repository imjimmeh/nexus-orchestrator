import { Injectable, Logger, Optional } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ISpecialStepHandler,
  SpecialStepExecutionContext,
  SpecialStepHandlerResult,
} from './step-special-step.types';
import {
  RUN_COMMAND_DEFAULT_TIMEOUT_MS,
  RUN_COMMAND_MAX_TIMEOUT_MS,
  type RunCommandExec,
} from './step-run-command-special-step.handler.types';

const execFileAsync = promisify(execFile);

@Injectable()
export class StepRunCommandSpecialStepHandler implements ISpecialStepHandler {
  readonly type = 'run_command' as const;
  readonly descriptor = {
    type: this.type,
    owningDomain: 'core',
    inputContract: 'inputs.command',
  } as const;

  private readonly logger = new Logger(StepRunCommandSpecialStepHandler.name);

  constructor(
    @Optional()
    private readonly execFn: RunCommandExec = execFileAsync,
  ) {}

  async execute({
    stepId,
    resolvedStepInputs,
  }: SpecialStepExecutionContext): Promise<SpecialStepHandlerResult> {
    const command = this.requireString(resolvedStepInputs, 'command', stepId);
    const timeoutMs = this.resolveTimeout(resolvedStepInputs);
    const cwd = this.resolveWorkingDir(resolvedStepInputs, stepId);

    this.logger.log(
      `run_command [${stepId}]: executing "${command}" in ${cwd} (timeout: ${timeoutMs}ms)`,
    );

    try {
      const { stdout, stderr } = await this.execFn('sh', ['-c', command], {
        cwd,
        timeout: timeoutMs,
      });

      return this.buildSuccessResult(stepId, stdout, stderr);
    } catch (error) {
      return this.buildFailureResult(stepId, timeoutMs, error);
    }
  }

  private buildSuccessResult(
    stepId: string,
    stdout: string,
    stderr: string,
  ): SpecialStepHandlerResult {
    const trimmedStdout = stdout.trimEnd();
    const trimmedStderr = stderr.trimEnd();

    this.logger.log(
      `run_command [${stepId}]: exit_code=0 stdout=${trimmedStdout.length} bytes`,
    );

    return {
      result: {
        status: 'completed',
        mode: 'run_command',
        exitCode: 0,
      },
      output: {
        ok: true,
        stepId,
        exit_code: 0,
        stdout: trimmedStdout,
        stderr: trimmedStderr,
        timed_out: false,
        stdout_lines: trimmedStdout ? trimmedStdout.split(/\r?\n/) : [],
      },
    };
  }

  private buildFailureResult(
    stepId: string,
    timeoutMs: number,
    error: unknown,
  ): SpecialStepHandlerResult {
    const err = error as {
      code?: string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    const exitCode = (error as { code?: number }).code ?? 1;
    const normalizedExitCode = typeof exitCode === 'number' ? exitCode : 1;
    const stdout = (err.stdout ?? '').trimEnd();
    const stderr = (err.stderr ?? '').trimEnd();

    if (err.killed) {
      this.logger.warn(
        `run_command [${stepId}]: killed after ${timeoutMs}ms timeout`,
      );
    } else {
      this.logger.warn(
        `run_command [${stepId}]: exit_code=${String(exitCode)}`,
      );
    }

    return {
      result: {
        status: 'completed',
        mode: 'run_command',
        exitCode: normalizedExitCode,
      },
      output: {
        ok: false,
        stepId,
        exit_code: normalizedExitCode,
        stdout,
        stderr,
        stdout_lines: stdout ? stdout.split(/\r?\n/) : [],
        timed_out: err.killed ?? false,
      },
    };
  }

  private resolveWorkingDir(
    inputs: Record<string, unknown>,
    stepId: string,
  ): string {
    const workingDir = inputs.working_dir;

    if (workingDir === undefined) {
      return process.cwd();
    }

    if (typeof workingDir === 'string' && workingDir.length > 0) {
      return workingDir;
    }

    throw new Error(
      `Step ${stepId}: run_command working_dir must be a path string`,
    );
  }

  private resolveTimeout(inputs: Record<string, unknown>): number {
    const raw = inputs.timeout_ms;
    if (raw === undefined || raw === null) {
      return RUN_COMMAND_DEFAULT_TIMEOUT_MS;
    }

    const value = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isNaN(value) || value <= 0) {
      return RUN_COMMAND_DEFAULT_TIMEOUT_MS;
    }

    return Math.min(value, RUN_COMMAND_MAX_TIMEOUT_MS);
  }

  private requireString(
    inputs: Record<string, unknown>,
    key: string,
    stepId: string,
  ): string {
    const value = inputs[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Step ${stepId}: run_command requires inputs.${key}`);
    }
    return value;
  }
}
