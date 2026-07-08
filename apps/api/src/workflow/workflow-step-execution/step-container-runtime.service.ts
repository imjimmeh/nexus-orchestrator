import { Injectable, Logger, Inject } from '@nestjs/common';
import Docker from 'dockerode';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import tar from 'tar-stream';
import { StepEventPublisherService } from './step-event-publisher.service';

@Injectable()
export class StepContainerRuntimeService {
  private readonly logger = new Logger(StepContainerRuntimeService.name);

  constructor(
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    private readonly eventPublisher: StepEventPublisherService,
  ) {}

  private sanitizeArchiveRelativePath(archiveEntryName: string): string | null {
    const normalized = archiveEntryName.replaceAll('\\', '/');
    const withoutWorkspacePrefix = normalized.replace(/^workspace\/?/, '');
    const withoutDotPrefix = withoutWorkspacePrefix.replace(/^\.\//, '');
    const relative = withoutDotPrefix.trim();

    if (!relative || relative === '.') {
      return null;
    }

    const normalizedRelative = path.posix.normalize(relative);
    if (
      normalizedRelative === '.' ||
      normalizedRelative.startsWith('../') ||
      path.posix.isAbsolute(normalizedRelative)
    ) {
      return null;
    }

    return normalizedRelative;
  }

  async executeCommand(
    containerId: string,
    params: {
      command: string;
      workingDir: string;
      timeoutMs: number;
    },
  ): Promise<{
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }> {
    const timeoutSeconds = Math.max(1, Math.ceil(params.timeoutMs / 1000));
    const timeoutMarker = '__NEXUS_RUN_COMMAND_TIMED_OUT__';
    const shellScript =
      'cmd="$1"; timeout_s="$2"; ' +
      '( sh -lc "$cmd" ) & pid=$!; ' +
      '( sleep "$timeout_s"; echo "' +
      timeoutMarker +
      '" >&2; kill -TERM "$pid" >/dev/null 2>&1 ) & timer=$!; ' +
      'wait "$pid"; status=$?; kill "$timer" >/dev/null 2>&1 || true; exit "$status"';

    const { exec, stream } = await this.startContainerExec(containerId, {
      command: params.command,
      workingDir: params.workingDir,
      timeoutSeconds,
      shellScript,
    });

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const stdoutChunks = this.collectChunks(stdoutStream);
    const stderrChunks = this.collectChunks(stderrStream);

    this.demuxDockerStream(stream, stdoutStream, stderrStream);
    await this.waitForStreamEnd(stream);

    const inspect = await exec.inspect();
    return this.buildExecCommandResult(
      inspect.ExitCode ?? undefined,
      stdoutChunks,
      stderrChunks,
      timeoutMarker,
    );
  }

  async exportWorkspaceArtifacts(
    container: Docker.Container,
    destinationDir: string,
  ): Promise<string[]> {
    fs.mkdirSync(destinationDir, { recursive: true });

    const archiveStream = await container.getArchive({ path: '/workspace' });
    const extractor = tar.extract();
    const exportedPaths: string[] = [];
    const destinationRoot = path.resolve(destinationDir);

    await new Promise<void>((resolve, reject) => {
      extractor.on(
        'entry',
        (
          header: tar.Headers,
          stream: NodeJS.ReadableStream,
          next: () => void,
        ) => {
          const relativePath = this.sanitizeArchiveRelativePath(header.name);
          if (!relativePath) {
            stream.resume();
            stream.on('end', () => {
              next();
            });
            return;
          }

          const targetPath = path.resolve(destinationRoot, relativePath);
          if (
            targetPath !== destinationRoot &&
            !targetPath.startsWith(`${destinationRoot}${path.sep}`)
          ) {
            stream.resume();
            stream.on('end', () => {
              next();
            });
            return;
          }

          if (header.type === 'directory') {
            fs.mkdirSync(targetPath, { recursive: true });
            stream.resume();
            stream.on('end', () => {
              next();
            });
            return;
          }

          if (header.type !== 'file') {
            stream.resume();
            stream.on('end', () => {
              next();
            });
            return;
          }

          const parentDir = path.dirname(targetPath);
          fs.mkdirSync(parentDir, { recursive: true });

          const fileStream = fs.createWriteStream(targetPath);
          stream.on('error', reject);
          fileStream.on('error', reject);
          fileStream.on('finish', () => {
            exportedPaths.push(targetPath);
            next();
          });
          stream.pipe(fileStream);
        },
      );

      extractor.on('error', reject);
      extractor.on('finish', () => {
        resolve();
      });
      archiveStream.on('error', reject);
      archiveStream.pipe(extractor);
    });

    return exportedPaths;
  }

  async startContainerLogStreaming(
    containerId: string,
    workflowRunId: string,
    stepId: string,
    onActivity: (() => void) | undefined,
  ): Promise<() => void> {
    const container = this.docker.getContainer(containerId);
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
    });

    if (!logStream || Buffer.isBuffer(logStream)) {
      return () => undefined;
    }

    const prefix = `[agent-container run=${workflowRunId} step=${stepId} container=${containerId}]`;

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const onStdout = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      onActivity?.();
      void this.eventPublisher.publishBashOutput(
        workflowRunId,
        stepId,
        containerId,
        'stdout',
        text,
      );
      stdoutBuffer = this.bufferAndEmitLines(text, stdoutBuffer, (line) => {
        this.logger.log(`${prefix} stdout ${line}`);
      });
    };

    const onStderr = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      onActivity?.();
      void this.eventPublisher.publishBashOutput(
        workflowRunId,
        stepId,
        containerId,
        'stderr',
        text,
      );
      stderrBuffer = this.bufferAndEmitLines(text, stderrBuffer, (line) => {
        this.logger.error(`${prefix} stderr ${line}`);
      });
    };

    stdoutStream.on('data', onStdout);
    stderrStream.on('data', onStderr);
    this.demuxDockerStream(logStream, stdoutStream, stderrStream);

    const stop = () => {
      if (stdoutBuffer.trim().length > 0) {
        this.logger.log(`${prefix} stdout ${stdoutBuffer}`);
      }
      if (stderrBuffer.trim().length > 0) {
        this.logger.error(`${prefix} stderr ${stderrBuffer}`);
      }

      stdoutStream.off('data', onStdout);
      stderrStream.off('data', onStderr);

      try {
        const streamWithDestroy = logStream as { destroy?: () => void };
        streamWithDestroy.destroy?.();
      } catch {
        // no-op
      }

      stdoutStream.end();
      stderrStream.end();
    };

    logStream.on('error', (error: Error) => {
      this.logger.warn(`${prefix} log stream error: ${error.message}`);
    });

    return stop;
  }

  private async startContainerExec(
    containerId: string,
    params: {
      command: string;
      workingDir: string;
      timeoutSeconds: number;
      shellScript: string;
    },
  ): Promise<{
    exec: Docker.Exec;
    stream: NodeJS.ReadableStream;
  }> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: params.workingDir,
      Cmd: [
        'sh',
        '-lc',
        params.shellScript,
        '--',
        params.command,
        String(params.timeoutSeconds),
      ],
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    return { exec, stream };
  }

  private collectChunks(stream: PassThrough): Buffer[] {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    return chunks;
  }

  private demuxDockerStream(
    multiplexedStream: NodeJS.ReadableStream,
    stdout: NodeJS.WritableStream,
    stderr: NodeJS.WritableStream,
  ): void {
    const dockerWithModem = this.docker as unknown as {
      modem?: {
        demuxStream?: (
          stream: NodeJS.ReadableStream,
          stdout: NodeJS.WritableStream,
          stderr: NodeJS.WritableStream,
        ) => void;
      };
    };

    if (typeof dockerWithModem.modem?.demuxStream !== 'function') {
      throw new TypeError('Docker modem demuxStream is unavailable');
    }

    dockerWithModem.modem.demuxStream(multiplexedStream, stdout, stderr);
  }

  private async waitForStreamEnd(stream: NodeJS.ReadableStream): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      stream.on('end', () => {
        resolve();
      });
      stream.on('error', reject);
    });
  }

  private buildExecCommandResult(
    exitCode: number | undefined,
    stdoutChunks: Buffer[],
    stderrChunks: Buffer[],
    timeoutMarker: string,
  ): {
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  } {
    const rawStdout = Buffer.concat(stdoutChunks).toString('utf-8').trimEnd();
    const rawStderr = Buffer.concat(stderrChunks).toString('utf-8');
    const timedOut = rawStderr.includes(timeoutMarker);
    const stderr = rawStderr.replaceAll(timeoutMarker, '').trimEnd();
    const normalizedExitCode = typeof exitCode === 'number' ? exitCode : 1;

    return {
      ok: normalizedExitCode === 0 && !timedOut,
      exitCode: normalizedExitCode,
      stdout: rawStdout,
      stderr,
      timedOut,
    };
  }

  private bufferAndEmitLines(
    chunk: string,
    buffered: string,
    logLine: (line: string) => void,
  ): string {
    const combined = buffered + chunk;
    const lines = combined.split(/\r?\n/);
    const remainder = lines.pop() || '';

    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }
      logLine(line);
    }

    return remainder;
  }

  async readContainerLogsTail(
    containerId: string,
    maxChars = 4000,
  ): Promise<string | undefined> {
    try {
      const container = this.docker.getContainer(containerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        timestamps: true,
      });

      const raw = Buffer.isBuffer(logs) ? logs.toString('utf-8') : String(logs);
      const sanitized = this.sanitizeLogText(raw);

      if (sanitized.length <= maxChars) {
        return sanitized;
      }

      return sanitized.slice(sanitized.length - maxChars);
    } catch {
      return undefined;
    }
  }

  private sanitizeLogText(value: string): string {
    let sanitized = '';

    for (const char of value) {
      const code = char.codePointAt(0) || 0;
      const isAllowedAscii = code >= 32 && code <= 126;
      const isAllowedWhitespace = code === 9 || code === 10 || code === 13;

      if (isAllowedAscii || isAllowedWhitespace) {
        sanitized += char;
      }
    }

    return sanitized;
  }
}
