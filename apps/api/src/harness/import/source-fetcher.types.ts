import type * as childProcess from 'node:child_process';
import type { HarnessAssetSource } from '@nexus/core';
import type { FetchResult } from './asset-importer.service.types.js';

/**
 * Injectable seam for fetching external harness assets.
 *
 * The default implementation resolves a git ref to a commit SHA and clones
 * the repository (or registry tarball), but it is never invoked during tests —
 * inject a fake implementation instead.
 *
 * Implementations MUST:
 * - Pin by resolved commit SHA (git) or content-digest (registry) and include
 *   that value as `resolvedRef` in the returned `FetchResult`.
 * - Never log secret values from `env` or `headers` fields in the source.
 * - Return only the files within the requested scope (plugin root or extension
 *   module) — not the whole repo.
 */
export interface SourceFetcher {
  fetch(source: HarnessAssetSource): Promise<FetchResult>;
}

/**
 * Discriminant codes for source-fetch failures.
 *
 * - `invalid_source` — the source descriptor failed security validation.
 * - `git_unavailable` — `git` is not on PATH or failed to spawn.
 * - `clone_failed` — `git clone` exited with a non-zero code.
 * - `rev_parse_failed` — `git rev-parse HEAD` exited with a non-zero code.
 * - `size_cap_exceeded` — total fetched bytes exceeded the configured cap.
 * - `unsupported` — the source kind is not supported (e.g. `registry` in v1).
 */
export type SourceFetchReason =
  | 'invalid_source'
  | 'git_unavailable'
  | 'clone_failed'
  | 'rev_parse_failed'
  | 'size_cap_exceeded'
  | 'unsupported';

/**
 * Thin adapter over Node.js system calls used by `DefaultSourceFetcher`.
 *
 * Inject a fake in tests to avoid real filesystem and process side-effects.
 * The default production instance delegates directly to `node:fs` and
 * `node:child_process`.
 */
export interface SystemAdapter {
  /** Equivalent to `child_process.spawn`. Returns a ChildProcess-like object. */
  spawn(
    cmd: string,
    args: string[],
    options: { cwd: string; stdio: ['ignore', 'pipe', 'pipe'] },
  ): Pick<childProcess.ChildProcess, 'stdout' | 'stderr' | 'on' | 'kill'>;
  /** Equivalent to `fs.mkdtempSync`. */
  mkdtempSync(prefix: string): string;
  /** Equivalent to `fs.rmSync`. */
  rmSync(
    dirPath: string,
    options: { recursive: boolean; force: boolean },
  ): void;
  /** Equivalent to `fs.readdirSync` with `withFileTypes: true`. */
  readdirSync(dirPath: string): Array<{ name: string; isDirectory(): boolean }>;
  /** Equivalent to `fs.statSync`. Returns an object with `size`. */
  statSync(filePath: string): { size: number };
  /** Equivalent to `fs.readFileSync` with `'utf8'` encoding. */
  readFileSync(filePath: string): string;
}

/** Options accepted by `DefaultSourceFetcher.fetch`. */
export interface DefaultFetchOptions {
  /**
   * Maximum total byte size of all fetched file contents combined.
   * Defaults to 5 MiB if not supplied.
   */
  sizeCap?: number;
  /**
   * Maximum milliseconds to wait for each `git` sub-process.
   * Defaults to 60 000 ms (1 minute).
   */
  gitTimeoutMs?: number;
}
