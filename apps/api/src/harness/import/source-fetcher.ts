import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HarnessAssetSource } from '@nexus/core';
import type {
  FetchResult,
  FetchedFile,
} from './asset-importer.service.types.js';
import type { SourceFetcher } from './source-fetcher.types.js';
import type {
  SystemAdapter,
  DefaultFetchOptions,
  SourceFetchReason,
} from './source-fetcher.types.js';

export type { SourceFetcher } from './source-fetcher.types.js';
export type { FetchResult } from './asset-importer.service.types.js';
export type {
  SystemAdapter,
  DefaultFetchOptions,
  SourceFetchReason,
} from './source-fetcher.types.js';

/**
 * Injection token for the `SourceFetcher` seam.
 * Wire the real fetcher in the NestJS module and override in tests.
 */
export const SOURCE_FETCHER = 'SOURCE_FETCHER' as const;

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Typed error thrown by `DefaultSourceFetcher` when a fetch cannot proceed.
 *
 * Callers should catch this and convert it to the appropriate HTTP exception.
 * The `reason` discriminant allows fine-grained error handling.
 */
export class SourceFetchError extends Error {
  readonly reason: SourceFetchReason;

  constructor(reason: SourceFetchReason, message: string) {
    super(message);
    this.name = 'SourceFetchError';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// System adapter (injectable for testing)
// ---------------------------------------------------------------------------

/** Production `SystemAdapter` backed by Node.js builtins. */
export const NODE_SYSTEM_ADAPTER: SystemAdapter = {
  spawn(cmd, args, options) {
    return childProcess.spawn(cmd, args, options);
  },
  mkdtempSync(prefix) {
    return fs.mkdtempSync(prefix);
  },
  rmSync(dirPath, options) {
    fs.rmSync(dirPath, options);
  },
  readdirSync(dirPath) {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  },
  statSync(filePath) {
    return fs.statSync(filePath);
  },
  readFileSync(filePath) {
    return fs.readFileSync(filePath, 'utf8');
  },
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum total byte size — 5 MiB. */
const DEFAULT_SIZE_CAP_BYTES = 5 * 1024 * 1024;
/** Default git sub-process timeout in milliseconds. */
const DEFAULT_GIT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the value is safe to pass as a git argument.
 *
 * Rejects values that start with `-` (option injection) and empty strings.
 * Deliberately permissive otherwise — git validates URL / ref syntax itself.
 */
function isArgSafe(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith('-')) return false;
  return true;
}

function assertGitSourceSafe(
  source: Extract<HarnessAssetSource, { kind: 'git' }>,
): void {
  if (!isArgSafe(source.repo)) {
    throw new SourceFetchError(
      'invalid_source',
      `git source 'repo' is not a valid argument: "${source.repo}"`,
    );
  }
  if (!isArgSafe(source.ref)) {
    throw new SourceFetchError(
      'invalid_source',
      `git source 'ref' is not a valid argument: "${source.ref}"`,
    );
  }
  if (source.subdir !== undefined && !isArgSafe(source.subdir)) {
    throw new SourceFetchError(
      'invalid_source',
      `git source 'subdir' is not a valid argument: "${source.subdir}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Child-process helpers
// ---------------------------------------------------------------------------

type SpawnLike = Pick<
  childProcess.ChildProcess,
  'stdout' | 'stderr' | 'on' | 'kill'
>;

/**
 * Runs a command via `sys.spawn` and resolves with the trimmed stdout.
 *
 * Rejects with `SourceFetchError` on non-zero exit or spawn failure.
 * Kills the process after `timeoutMs`.
 *
 * SECURITY: stderr is consumed but never logged — it may contain credentials.
 */
function runCommand(
  sys: SystemAdapter,
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  rejectReason: SourceFetchReason,
  rejectMessage: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let proc: SpawnLike;
    try {
      proc = sys.spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(
        new SourceFetchError(
          'git_unavailable',
          `Failed to spawn '${cmd}': ${String(err)}`,
        ),
      );
      return;
    }

    const stdoutChunks: Buffer[] = [];

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    // Consume stderr silently — never log it (may contain credentials).
    proc.stderr?.on('data', () => undefined);

    const timer = setTimeout(() => {
      proc.kill();
      reject(
        new SourceFetchError(
          'git_unavailable',
          `'${cmd} ${args[0] ?? ''}' timed out after ${timeoutMs.toString()}ms`,
        ),
      );
    }, timeoutMs);

    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString('utf8').trim());
      } else {
        reject(new SourceFetchError(rejectReason, rejectMessage));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

/**
 * Reads all files under `dirPath` recursively into `FetchedFile[]`.
 * Paths are relative to `dirPath` using forward-slash separators.
 * Throws `SourceFetchError('size_cap_exceeded')` if total bytes > sizeCap.
 */
function readDirRecursive(
  sys: SystemAdapter,
  dirPath: string,
  base: string,
  sizeCap: number,
  accumulated: { total: number },
): FetchedFile[] {
  const entries = sys.readdirSync(dirPath);
  const files: FetchedFile[] = [];

  for (const entry of entries) {
    const absPath = path.join(dirPath, entry.name);
    const relPath = base.length > 0 ? `${base}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const nested = readDirRecursive(
        sys,
        absPath,
        relPath,
        sizeCap,
        accumulated,
      );
      files.push(...nested);
    } else {
      const stat = sys.statSync(absPath);
      accumulated.total += stat.size;
      if (accumulated.total > sizeCap) {
        throw new SourceFetchError(
          'size_cap_exceeded',
          `Fetched asset size exceeded the cap of ${sizeCap.toString()} bytes`,
        );
      }
      const contents = sys.readFileSync(absPath);
      files.push({ path: relPath, contents });
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Main implementation
// ---------------------------------------------------------------------------

/**
 * Default production fetcher.
 *
 * ### `git` source
 * Clones the repository at the given ref using `--depth 1` to minimise
 * network traffic, then runs `git rev-parse HEAD` to capture the resolved
 * commit SHA.  If `source.subdir` is set, only files within that subdirectory
 * are returned (using it as the root).  The temp directory is always deleted
 * in a `finally` block.
 *
 * Security guards applied before spawning any process:
 * - `repo`, `ref`, and `subdir` must not start with `-` (option injection).
 * - All values are passed as discrete array arguments — never interpolated
 *   into a shell string.
 * - Each child process is killed after `gitTimeoutMs` (default 60 s).
 * - Credentials and file contents are never logged.
 *
 * ### `registry` source
 * Not supported in v1.  Throws `SourceFetchError('unsupported')` with an
 * explicit message.  Registry imports are deferred to a future task that will
 * integrate with the Nexus plugin registry tarball API.
 *
 * ### `authored` source
 * Not a fetch source — authored assets are baked into the image.
 * Throws `SourceFetchError('unsupported')`.
 *
 * **Image requirement:** the `nexus-api` container image must include `git`
 * on PATH.  See the Task 5 runbook for the Dockerfile change required.
 *
 * @param sys - Injectable system adapter; defaults to the real Node.js builtins.
 *   Pass a fake in tests to avoid real filesystem and process side-effects.
 */
export class DefaultSourceFetcher implements SourceFetcher {
  constructor(private readonly sys: SystemAdapter = NODE_SYSTEM_ADAPTER) {}

  async fetch(
    source: HarnessAssetSource,
    opts: DefaultFetchOptions = {},
  ): Promise<FetchResult> {
    if (source.kind === 'authored') {
      throw new SourceFetchError(
        'unsupported',
        'DefaultSourceFetcher: authored assets are baked into the image — nothing to fetch',
      );
    }

    if (source.kind === 'registry') {
      // Registry fetch is deferred to v2. The registry tarball API integration
      // is tracked in Task 5 of EPIC-211.
      throw new SourceFetchError(
        'unsupported',
        'DefaultSourceFetcher: registry fetch is not supported in v1 — ' +
          'registry integration is deferred to a future task that will use the ' +
          'Nexus plugin registry tarball API',
      );
    }

    // source.kind === 'git'
    return this.fetchGit(source, opts);
  }

  private async fetchGit(
    source: Extract<HarnessAssetSource, { kind: 'git' }>,
    opts: DefaultFetchOptions,
  ): Promise<FetchResult> {
    const sizeCap = opts.sizeCap ?? DEFAULT_SIZE_CAP_BYTES;
    const timeoutMs = opts.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;

    // Security: validate all args before spawning anything.
    assertGitSourceSafe(source);

    const tmpDir = this.sys.mkdtempSync(path.join(os.tmpdir(), 'nexus-sf-'));
    try {
      await this.cloneAtRef(source, tmpDir, timeoutMs);

      // Resolve the exact commit SHA for immutable pinning.
      const resolvedRef = await runCommand(
        this.sys,
        'git',
        ['rev-parse', 'HEAD'],
        tmpDir,
        timeoutMs,
        'rev_parse_failed',
        `Failed to resolve HEAD commit SHA in cloned repo '${source.repo}'`,
      );

      // Determine read root (whole repo or a subdir).
      const readRoot =
        source.subdir !== undefined ? path.join(tmpDir, source.subdir) : tmpDir;

      const accumulated = { total: 0 };
      const files = readDirRecursive(
        this.sys,
        readRoot,
        '',
        sizeCap,
        accumulated,
      );

      return { files, resolvedRef };
    } finally {
      this.sys.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Attempts `git clone --depth 1 --branch <ref> <repo> <tmpDir>`.
   * Falls back to `git clone --depth 1 <repo> <tmpDir>` + `git checkout <ref>`
   * for non-branch refs (commit SHAs, arbitrary refs).
   */
  private async cloneAtRef(
    source: Extract<HarnessAssetSource, { kind: 'git' }>,
    tmpDir: string,
    timeoutMs: number,
  ): Promise<void> {
    try {
      await runCommand(
        this.sys,
        'git',
        ['clone', '--depth', '1', '--branch', source.ref, source.repo, tmpDir],
        os.tmpdir(),
        timeoutMs,
        'clone_failed',
        `Failed to clone '${source.repo}' at ref '${source.ref}'`,
      );
    } catch (firstErr) {
      if (
        !(firstErr instanceof SourceFetchError) ||
        firstErr.reason !== 'clone_failed'
      ) {
        throw firstErr;
      }
      // Fallback: clone default branch then checkout the ref explicitly.
      await runCommand(
        this.sys,
        'git',
        ['clone', '--depth', '1', source.repo, tmpDir],
        os.tmpdir(),
        timeoutMs,
        'clone_failed',
        `Failed to clone repository '${source.repo}'`,
      );
      await runCommand(
        this.sys,
        'git',
        ['checkout', source.ref],
        tmpDir,
        timeoutMs,
        'clone_failed',
        `Failed to checkout ref '${source.ref}' in '${source.repo}'`,
      );
    }
  }
}
