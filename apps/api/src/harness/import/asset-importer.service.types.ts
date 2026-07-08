import type { HarnessAssetKind } from '../assets/harness-asset.types.js';
import type { HarnessAssetSource } from '@nexus/core';

/**
 * The safe, redacted summary returned by `prepareImport` (and by the preview
 * endpoint).  Secret env / header values resolved from the source are NEVER
 * included — only the manifest fields that are safe to expose publicly.
 */
export interface PrepareImportResult {
  /** Asset kind detected during vetting (`'plugin'` | `'extension'`). */
  kind: Extract<HarnessAssetKind, 'plugin' | 'extension'>;
  /**
   * Safe manifest summary — CC plugin: parsed plugin.json without secrets;
   * PI extension: `{ entry }`.  MUST NOT include resolved env / header values.
   */
  manifest: Record<string, unknown>;
  /** Canonical content-hash: `sha256:<hex>` over the normalised bundle. */
  checksum: string;
  /**
   * The source descriptor with the mutable ref replaced by the resolved commit
   * SHA / digest, so the confirm step can re-fetch deterministically.
   */
  pinnedSource: HarnessAssetSource;
  /** Total byte size of all fetched files combined. */
  bundleSizeBytes: number;
}

/**
 * Options for `prepareImport` and `confirmImport`.
 */
export interface ImportPreviewOptions {
  /**
   * Maximum total byte size of all fetched file contents combined.
   * Defaults to `DEFAULT_SIZE_CAP_BYTES` when not supplied.
   */
  sizeCap?: number;
  /**
   * Optional denylist of repo URLs or registry package names that must be
   * rejected regardless of any other validation.  Strings are compared
   * case-insensitively.
   */
  denylist?: string[];
  /** Optional scope node to associate with the persisted asset row. */
  scopeNodeId?: string | null;
}

/**
 * A single file returned by the source fetcher.
 *
 * `path` is relative to the fetch root (e.g. `.claude-plugin/plugin.json`).
 * `contents` is the raw UTF-8 text of the file.
 */
export interface FetchedFile {
  /** Path relative to the fetch root, using forward-slash separators. */
  path: string;
  /** Raw UTF-8 file contents. */
  contents: string;
}

/**
 * Result returned by a `SourceFetcher` after resolving and fetching an asset.
 *
 * - `files` — all files in the fetched tree (relative paths, UTF-8 contents).
 * - `resolvedRef` — the pinned commit SHA or digest that was actually fetched.
 *   For git sources this is the resolved commit SHA; for registry sources it is
 *   the resolved package version or content-hash.
 */
export interface FetchResult {
  files: FetchedFile[];
  resolvedRef: string;
}

/**
 * Options passed to `importAsset`.
 */
export interface ImportAssetOptions {
  /**
   * Maximum total byte size of all fetched file contents combined.
   * Import is rejected when the sum exceeds this cap.
   *
   * Defaults to `DEFAULT_SIZE_CAP_BYTES` when not supplied.
   */
  sizeCap?: number;

  /**
   * Optional denylist of repo URLs or registry package names that must be
   * rejected regardless of any other validation.  Strings are compared
   * case-insensitively.
   */
  denylist?: string[];

  /** Optional scope node to associate with the persisted asset row. */
  scopeNodeId?: string | null;
}
