import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ToolCandidateLanguage,
  ToolValidationRunStatus,
} from '@nexus/core';
import type {
  ToolSandboxCandidateInput,
  ToolSandboxRunResult,
} from './tool-sandbox.types';

const RESULT_MARKER = '__NEXUS_RESULT__';
const DEFAULT_VALIDATE_TIMEOUT_MS = 5000;
const DEFAULT_EXECUTE_TIMEOUT_MS = 10000;

@Injectable()
export class ToolSandboxService {
  async validateCandidate(
    input: ToolSandboxCandidateInput,
  ): Promise<ToolSandboxRunResult> {
    return this.runCandidate({
      ...input,
      params: input.params ?? {},
      timeout_ms: input.timeout_ms ?? DEFAULT_VALIDATE_TIMEOUT_MS,
    });
  }

  async executeCandidate(
    input: ToolSandboxCandidateInput,
  ): Promise<ToolSandboxRunResult> {
    return this.runCandidate({
      ...input,
      params: input.params ?? {},
      timeout_ms: input.timeout_ms ?? DEFAULT_EXECUTE_TIMEOUT_MS,
    });
  }

  private async runCandidate(
    input: ToolSandboxCandidateInput,
  ): Promise<ToolSandboxRunResult> {
    const denials = this.getPolicyDenials(input.language, input.source_code);
    const sandboxImage = this.resolveSandboxImage(input.language);
    if (denials.length > 0) {
      return {
        status: 'policy_denied',
        exit_code: null,
        stdout: '',
        stderr: 'Candidate denied by sandbox policy',
        duration_ms: 0,
        sandbox_image: sandboxImage,
        policy_denials: { reasons: denials },
      };
    }

    const workDir = await mkdtemp(join(tmpdir(), 'nexus-tool-sandbox-'));
    try {
      const processResult =
        input.language === 'python'
          ? await this.runPythonCandidate(workDir, input)
          : await this.runNodeCandidate(workDir, input);

      const output = this.parseExecutionOutput(processResult.stdout);
      return {
        status: this.resolveStatus(processResult),
        exit_code: processResult.exitCode,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        duration_ms: processResult.durationMs,
        sandbox_image: sandboxImage,
        policy_denials: null,
        output,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Sandbox execution failed';
      return {
        status: 'failed',
        exit_code: 1,
        stdout: '',
        stderr: message,
        duration_ms: 0,
        sandbox_image: sandboxImage,
        policy_denials: null,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async runNodeCandidate(
    workDir: string,
    input: ToolSandboxCandidateInput,
  ): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
  }> {
    await writeFile(join(workDir, 'candidate.mjs'), input.source_code, 'utf8');
    await writeFile(
      join(workDir, 'input.json'),
      JSON.stringify(input.params ?? {}),
      'utf8',
    );
    await writeFile(
      join(workDir, 'runner.mjs'),
      `
import { readFile } from 'node:fs/promises';

const params = JSON.parse(await readFile(new URL('./input.json', import.meta.url), 'utf8'));
const moduleRef = await import(new URL('./candidate.mjs', import.meta.url).href);
const entry = moduleRef.execute ?? moduleRef.run ?? moduleRef.default;
if (typeof entry !== 'function') {
  throw new Error('Candidate must export execute, run, or default function');
}
const result = await entry(params);
process.stdout.write('${RESULT_MARKER}' + JSON.stringify(result ?? null) + '\\n');
`,
      'utf8',
    );

    return this.runProcess(process.execPath, ['runner.mjs'], workDir, input);
  }

  private async runPythonCandidate(
    workDir: string,
    input: ToolSandboxCandidateInput,
  ): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
  }> {
    await writeFile(join(workDir, 'candidate.py'), input.source_code, 'utf8');
    await writeFile(
      join(workDir, 'input.json'),
      JSON.stringify(input.params ?? {}),
      'utf8',
    );
    await writeFile(
      join(workDir, 'runner.py'),
      `
import importlib.util
import inspect
import json
from pathlib import Path

base = Path(__file__).parent
params = json.loads((base / "input.json").read_text(encoding="utf-8"))
spec = importlib.util.spec_from_file_location("candidate", str(base / "candidate.py"))
if spec is None or spec.loader is None:
    raise RuntimeError("Unable to load candidate module")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
entry = getattr(module, "execute", None) or getattr(module, "run", None) or getattr(module, "main", None)
if not callable(entry):
    raise RuntimeError("Candidate must define execute, run, or main function")
result = entry(params)
if inspect.isawaitable(result):
    import asyncio
    result = asyncio.run(result)
print("${RESULT_MARKER}" + json.dumps(result))
`,
      'utf8',
    );

    const pythonBin = platform() === 'win32' ? 'python' : 'python3';
    return this.runProcess(pythonBin, ['runner.py'], workDir, input);
  }

  private runProcess(
    command: string,
    args: string[],
    cwd: string,
    input: ToolSandboxCandidateInput,
  ): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
  }> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const child = spawn(command, args, {
        cwd,
        shell: false,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, input.timeout_ms ?? DEFAULT_EXECUTE_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        resolve({
          exitCode: 1,
          stdout,
          stderr: `${stderr}${error.message}`,
          timedOut: false,
          durationMs: Date.now() - startedAt,
        });
      });

      child.on('close', (exitCode: number | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        resolve({
          exitCode,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }

  private resolveStatus(result: {
    exitCode: number | null;
    timedOut: boolean;
  }): ToolValidationRunStatus {
    if (result.timedOut) {
      return 'timeout';
    }
    return result.exitCode === 0 ? 'passed' : 'failed';
  }

  private parseExecutionOutput(stdout: string): unknown {
    const markerIndex = stdout.lastIndexOf(RESULT_MARKER);
    if (markerIndex < 0) {
      return undefined;
    }

    const resultPayload = stdout
      .slice(markerIndex + RESULT_MARKER.length)
      .split(/\r?\n/u)[0]
      .trim();
    if (!resultPayload) {
      return undefined;
    }

    try {
      return JSON.parse(resultPayload) as unknown;
    } catch {
      return undefined;
    }
  }

  private resolveSandboxImage(language: ToolCandidateLanguage): string {
    return language === 'python'
      ? 'local-python-sandbox'
      : 'local-node-sandbox';
  }

  private getPolicyDenials(
    language: ToolCandidateLanguage,
    sourceCode: string,
  ): string[] {
    const patterns =
      language === 'python'
        ? [
            /(^|\s)import\s+os(\s|$)/u,
            /(^|\s)import\s+subprocess(\s|$)/u,
            /(^|\s)from\s+os\s+import(\s|$)/u,
            /(^|\s)from\s+subprocess\s+import(\s|$)/u,
            /\beval\s*\(/u,
            /\bexec\s*\(/u,
          ]
        : [
            /\brequire\s*\(\s*['"]child_process['"]\s*\)/u,
            /\brequire\s*\(\s*['"]fs['"]\s*\)/u,
            /\bimport\s+.*\s+from\s+['"]child_process['"]/u,
            /\bimport\s+.*\s+from\s+['"]fs['"]/u,
            /\bprocess\.env\b/u,
            /\beval\s*\(/u,
            /\bFunction\s*\(/u,
          ];

    const denials: string[] = [];
    for (const pattern of patterns) {
      if (pattern.test(sourceCode)) {
        denials.push(`Matched forbidden pattern: ${pattern.source}`);
      }
    }
    return denials;
  }
}
