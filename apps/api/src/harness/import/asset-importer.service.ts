import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { HarnessAssetSource } from '@nexus/core';
import { HarnessAssetRepository } from '../assets/harness-asset.repository.js';
import { computeAssetChecksum } from '@nexus/core';
import {
  buildExtensionBundle,
  buildPluginBundle,
} from '../assets/bundle-builders.js';
import { SOURCE_FETCHER } from './source-fetcher.js';
import type { SourceFetcher } from './source-fetcher.js';
import {
  vetCcPlugin,
  vetPiExtension,
  checkSizeCap,
  checkDenylist,
  DEFAULT_SIZE_CAP_BYTES,
} from './asset-vetting.js';
import type {
  ImportAssetOptions,
  ImportPreviewOptions,
  PrepareImportResult,
} from './asset-importer.service.types.js';

export type { ImportAssetOptions } from './asset-importer.service.types.js';
export type {
  ImportPreviewOptions,
  PrepareImportResult,
} from './asset-importer.service.types.js';

/** Resolved version string used when no explicit version is available from the source. */
const RESOLVED_REF_VERSION_PREFIX = 'git-' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the denylist identifier for a given source — the repo URL for git
 * sources and the package name for registry sources.
 * Returns `null` for authored sources (no denylist check applies).
 */
function denylistIdentifier(source: HarnessAssetSource): string | null {
  if (source.kind === 'git') return source.repo;
  if (source.kind === 'registry') return source.name;
  return null;
}

/**
 * Derives a human-readable asset name from the source.
 *
 * For git sources: last path segment of the repo URL (without `.git` suffix).
 * For registry sources: the package name.
 * For authored sources: 'authored'.
 */
function deriveName(source: HarnessAssetSource, resolvedName?: string): string {
  if (resolvedName !== undefined && resolvedName.length > 0) {
    return resolvedName;
  }
  if (source.kind === 'git') {
    const segments = source.repo.replace(/\.git$/i, '').split('/');
    return segments[segments.length - 1] ?? 'unknown';
  }
  if (source.kind === 'registry') {
    return source.name;
  }
  return 'authored';
}

/**
 * Builds the pinned provenance source: substitutes the user-supplied ref with
 * the RESOLVED commit SHA / digest from the fetcher so that the stored row
 * always carries an immutable pin.
 */
function buildPinnedSource(
  source: HarnessAssetSource,
  resolvedRef: string,
): HarnessAssetSource {
  if (source.kind === 'git') {
    return { ...source, ref: resolvedRef };
  }
  if (source.kind === 'registry') {
    return { ...source, version: resolvedRef };
  }
  return source;
}

/**
 * Derives the version column value from source kind and the resolved ref.
 *
 * For registry sources: the resolved digest is stored verbatim (Fix I-2).
 * For all other sources: prefixed with `git-` to indicate a resolved SHA.
 */
function deriveVersion(
  source: HarnessAssetSource,
  resolvedRef: string,
): string {
  if (source.kind === 'registry') return resolvedRef;
  return `${RESOLVED_REF_VERSION_PREFIX}${resolvedRef}`;
}

// ---------------------------------------------------------------------------
// Internal pipeline result
// ---------------------------------------------------------------------------

/**
 * The full pipeline result produced by `runCorePipeline`.
 *
 * Carries both the safe manifest for preview AND the internal bundle + name
 * needed to persist the asset row.
 */
interface CorePipelineResult {
  kind: 'plugin' | 'extension';
  /** Safe manifest summary — MUST NOT contain resolved secret values. */
  manifest: Record<string, unknown>;
  checksum: string;
  pinnedSource: HarnessAssetSource;
  bundleSizeBytes: number;
  /** The serialised bundle, needed only for persistence. */
  bundle: string;
  /** Derived asset name, needed only for persistence. */
  name: string;
  /** Version column value (pinned ref, prefixed for git sources). */
  version: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Fetches an external CC plugin or PI extension from a pinned source, vets it,
 * computes the canonical checksum, and (optionally) persists an immutable asset row.
 *
 * Supply-chain guarantees (per spec §10):
 * - The source ref is resolved to a commit SHA / content-digest before persisting.
 * - The canonical checksum (`computeAssetChecksum`) is computed over the
 *   normalised bundle so hydration's verify + Task-5 re-verify always match.
 * - Total fetched bytes are capped (`sizeCap`, default 5 MiB).
 * - An optional `denylist` blocks known-bad repos / packages.
 * - Bundle contents are never logged.
 * - Secret env / header values are NEVER included in the preview manifest.
 */
@Injectable()
export class AssetImporterService {
  constructor(
    private readonly repo: HarnessAssetRepository,
    @Inject(SOURCE_FETCHER) private readonly fetcher: SourceFetcher,
  ) {}

  /**
   * Runs the shared fetch → vet → bundle → checksum pipeline WITHOUT persisting.
   *
   * Returns a `PrepareImportResult` safe for API exposure: the manifest summary
   * never includes resolved secret env / header values.
   *
   * Throws `UnprocessableEntityException` for any vetting failure.
   */
  async prepareImport(
    source: HarnessAssetSource,
    opts: ImportPreviewOptions = {},
  ): Promise<PrepareImportResult> {
    const result = await this.runCorePipeline(source, opts);
    return {
      kind: result.kind,
      manifest: result.manifest,
      checksum: result.checksum,
      pinnedSource: result.pinnedSource,
      bundleSizeBytes: result.bundleSizeBytes,
    };
  }

  /**
   * Runs the shared pipeline at the PINNED ref and PERSISTS the immutable row.
   *
   * Returns the id of the newly created asset row.
   *
   * Throws `UnprocessableEntityException` for any vetting failure.
   */
  async confirmImport(
    source: HarnessAssetSource,
    opts: ImportPreviewOptions = {},
  ): Promise<string> {
    const result = await this.runCorePipeline(source, opts);
    const entity = await this.repo.create({
      kind: result.kind,
      name: result.name,
      version: result.version,
      source: result.pinnedSource,
      checksum: result.checksum,
      bundle: result.bundle,
      scopeNodeId: opts.scopeNodeId ?? null,
    });
    return entity.id;
  }

  /**
   * Imports an external harness asset.
   *
   * Delegates to `confirmImport` — the shared pipeline entry point that
   * fetches, vets, checksums, and persists an immutable asset row.
   *
   * Returns the id of the newly persisted asset row.
   *
   * Throws `UnprocessableEntityException` for any vetting failure.
   */
  async importAsset(
    source: HarnessAssetSource,
    opts: ImportAssetOptions = {},
  ): Promise<string> {
    return this.confirmImport(source, opts);
  }

  // ---------------------------------------------------------------------------
  // Shared core pipeline
  // ---------------------------------------------------------------------------

  /**
   * The single shared pipeline: denylist → fetch → size-cap → vet → bundle → checksum.
   *
   * Called by both `prepareImport` (no persist) and `confirmImport` (with persist).
   * There is only ONE pipeline — preview and confirm are NOT divergent code paths.
   */
  private async runCorePipeline(
    source: HarnessAssetSource,
    opts: ImportPreviewOptions,
  ): Promise<CorePipelineResult> {
    const { sizeCap = DEFAULT_SIZE_CAP_BYTES, denylist = [] } = opts;

    // 1. Denylist check — fast-fail before issuing any network request.
    const identifier = denylistIdentifier(source);
    if (identifier !== null && denylist.length > 0) {
      const denyErr = checkDenylist(identifier, denylist);
      if (denyErr !== null) {
        throw new UnprocessableEntityException(denyErr.message);
      }
    }

    // 2. Fetch at the pinned ref.
    const { files, resolvedRef } = await this.fetcher.fetch(source);

    // 3. Size-cap enforcement.
    const sizeErr = checkSizeCap(files, sizeCap);
    if (sizeErr !== null) {
      throw new UnprocessableEntityException(sizeErr.message);
    }

    const bundleSizeBytes = files.reduce(
      (sum, f) => sum + Buffer.byteLength(f.contents, 'utf8'),
      0,
    );

    // 4. Asset-type detection + vetting.
    //
    // Heuristic: if the fetch tree contains `.claude-plugin/plugin.json` we
    // treat it as a CC plugin; otherwise we attempt PI extension vetting.
    const hasCcManifest = files.some(
      (f) => f.path === '.claude-plugin/plugin.json',
    );

    if (hasCcManifest) {
      return this.prepareCcPlugin(source, resolvedRef, files, bundleSizeBytes);
    }

    return this.preparePiExtension(source, resolvedRef, files, bundleSizeBytes);
  }

  // ---------------------------------------------------------------------------
  // Private per-kind pipeline steps
  // ---------------------------------------------------------------------------

  private prepareCcPlugin(
    source: HarnessAssetSource,
    resolvedRef: string,
    files: Array<{ path: string; contents: string }>,
    bundleSizeBytes: number,
  ): CorePipelineResult {
    const vetResult = vetCcPlugin(files);
    if (!vetResult.ok) {
      throw new UnprocessableEntityException(vetResult.error.message);
    }

    const { name, manifest, hooks } = vetResult.value;

    // Normalize to the same bundle shape the author path persists.
    // `capabilities` is extracted from the raw manifest so the hydration
    // projection (`entityToPlugin`) can always read `manifest['capabilities']`.
    //
    // Hooks parsed from `hooks/hooks.json` are merged into capabilities so that
    // Phase-3 staging (`buildHooksJson`) can re-emit them verbatim — an imported
    // hooks-bearing plugin must behave identically to an authored one at runtime.
    const manifestCapabilities =
      (manifest['capabilities'] as Record<string, unknown> | undefined) ?? {};

    const capabilities: Record<string, unknown> = {
      ...manifestCapabilities,
      ...(hooks.length > 0 ? { hooks } : {}),
    };

    const bundlePayload: Record<string, unknown> = {
      ...manifest,
      capabilities,
    };

    const bundle = buildPluginBundle(bundlePayload);
    const checksum = computeAssetChecksum(bundle);
    const pinnedSource = buildPinnedSource(source, resolvedRef);
    const version = deriveVersion(source, resolvedRef);

    // Build the safe manifest summary: only named, non-secret fields from the
    // parsed manifest. Any env / header values from the source are never in
    // `manifest` — they exist only in `source`, which is already pinned.
    const safeManifest: Record<string, unknown> = {
      name,
      capabilities,
    };
    if (manifest['description'] !== undefined) {
      safeManifest['description'] = manifest['description'];
    }

    return {
      kind: 'plugin',
      manifest: safeManifest,
      checksum,
      pinnedSource,
      bundleSizeBytes,
      bundle,
      name: deriveName(source, name),
      version,
    };
  }

  private preparePiExtension(
    source: HarnessAssetSource,
    resolvedRef: string,
    files: Array<{ path: string; contents: string }>,
    bundleSizeBytes: number,
  ): CorePipelineResult {
    const vetResult = vetPiExtension(files);
    if (!vetResult.ok) {
      throw new UnprocessableEntityException(vetResult.error.message);
    }

    const { entry, moduleSource } = vetResult.value;

    // Normalize to the same bundle shape the author path persists.
    const bundlePayload = {
      runtime: 'ts-module' as const,
      entry,
      moduleSource,
    };

    const bundle = buildExtensionBundle(bundlePayload);
    const checksum = computeAssetChecksum(bundle);
    const pinnedSource = buildPinnedSource(source, resolvedRef);
    const version = deriveVersion(source, resolvedRef);

    // Safe manifest: entry path only — moduleSource is source code, not secret,
    // but is omitted from the preview manifest to keep the preview response small.
    const safeManifest: Record<string, unknown> = { entry };

    return {
      kind: 'extension',
      manifest: safeManifest,
      checksum,
      pinnedSource,
      bundleSizeBytes,
      bundle,
      name: deriveName(source),
      version,
    };
  }
}
