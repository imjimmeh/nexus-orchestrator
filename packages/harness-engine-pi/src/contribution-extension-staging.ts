/**
 * Stage authored `ts-module` extension assets as files for PI's jiti loader.
 *
 * PI loads extension modules from `ctx.extensionsPath` via jiti (`.ts` files,
 * excludes `index.ts`). For each `ts-module` extension asset that carries a
 * `moduleSource`, the source is written to a deterministically-named `.ts` file
 * under `extensionsPath` BEFORE `resolveExtensionPaths` / `DefaultResourceLoader`
 * scans the directory.
 *
 * Extensions without a `moduleSource` (e.g. pre-EPIC-211 rows, or ones where
 * bundle hydration produced no source) are dropped with a diagnostic and do NOT
 * crash staging of sibling extensions.
 *
 * `package`-runtime assets are skipped with a note — multi-file package staging
 * is deferred to a later task.
 *
 * Staged files are cleaned up on session dispose (see `cleanupStagedExtensions`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { HarnessExtensionAsset } from "@nexus/core";
import { computeAssetChecksum } from "@nexus/core";
import type {
  DroppedExtension,
  ExtensionStagingResult,
} from "./contribution-extension-staging.types.js";

export type {
  DroppedExtension,
  ExtensionStagingResult,
} from "./contribution-extension-staging.types.js";

/**
 * Stage each `ts-module` extension asset that carries a `moduleSource` as a
 * `.ts` file under `extensionsPath`.
 *
 * Returns the absolute paths of every successfully staged file.
 * Extensions that are dropped (missing source, unsupported runtime) produce
 * entries in `ExtensionStagingResult.dropped` but never throw.
 *
 * Files are named `ext-<id>-<sanitized-name>.ts` — deterministic, unique per
 * session, and never `index.ts` (PI's loader explicitly excludes that name).
 */
export function stageExtensionAssets(
  extensionsPath: string,
  extensions: HarnessExtensionAsset[],
): string[] {
  const { stagedPaths } = stageExtensionAssetsWithDiagnostics(
    extensionsPath,
    extensions,
  );
  return stagedPaths;
}

/**
 * Same as {@link stageExtensionAssets} but also returns the dropped list for
 * callers that want to forward diagnostics.
 */
export function stageExtensionAssetsWithDiagnostics(
  extensionsPath: string,
  extensions: HarnessExtensionAsset[],
): ExtensionStagingResult {
  // Fast path: empty input ⇒ zero filesystem side-effects.
  // An empty-extensions session must be byte-identical to the pre-EPIC-211
  // baseline — no directory is created, no files are written.
  if (extensions.length === 0) {
    return { stagedPaths: [], dropped: [] };
  }

  const stagedPaths: string[] = [];
  const dropped: DroppedExtension[] = [];

  // Create the extensions directory once before the loop so that each
  // per-extension write can skip the redundant mkdirSync call.
  fs.mkdirSync(extensionsPath, { recursive: true });

  for (const ext of extensions) {
    // Defense-in-depth: re-verify the checksum over the canonical bundle before
    // writing anything. A missing bundle drops with `missing_bundle`; a present
    // bundle whose digest mismatches drops with `checksum_mismatch`. Siblings
    // continue unaffected. Never throws.
    if (typeof ext.bundle !== "string") {
      dropped.push({ id: ext.id, name: ext.name, reason: "missing_bundle" });
      continue;
    }
    if (computeAssetChecksum(ext.bundle) !== ext.checksum) {
      dropped.push({ id: ext.id, name: ext.name, reason: "checksum_mismatch" });
      continue;
    }

    if (ext.runtime === "package") {
      // package-runtime staging is deferred; skip without crashing.
      dropped.push({
        id: ext.id,
        name: ext.name,
        reason: "package_runtime_deferred",
      });
      continue;
    }

    // ts-module: require moduleSource to stage.
    if (typeof ext.moduleSource !== "string" || ext.moduleSource.length === 0) {
      dropped.push({ id: ext.id, name: ext.name, reason: "missing_source" });
      continue;
    }

    const filename = deriveFilename(ext.id);
    const filePath = path.join(extensionsPath, filename);
    try {
      fs.writeFileSync(filePath, ext.moduleSource, { encoding: "utf-8" });
      stagedPaths.push(filePath);
    } catch {
      // FS write failure (disk full, permission denied, etc.) — drop this
      // extension with a diagnostic and continue staging siblings.
      dropped.push({
        id: ext.id,
        name: ext.name,
        reason: "stage_write_failed",
      });
    }
  }

  return { stagedPaths, dropped };
}

/**
 * Remove each staged extension file on session dispose (best-effort).
 * Files that have already been deleted (or were never written) are silently
 * ignored so cleanup never throws.
 */
export function cleanupStagedExtensions(
  stagedPaths: ReadonlyArray<string>,
): void {
  for (const filePath of stagedPaths) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup — ignore missing-file or permission errors.
    }
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic, safe filename for an extension asset.
 *
 * Format: `ext-<sanitized-id>-mod.ts`
 *
 * Using the asset id guarantees uniqueness within a session's extension set
 * (ids are UUIDs). The fixed `-mod` suffix before `.ts` ensures the filename
 * never ends in `index.ts`, which PI's loader explicitly excludes when scanning
 * the extensions directory.
 *
 * Sanitization replaces any character that is not alphanumeric, a hyphen, or
 * an underscore with a hyphen, then collapses consecutive hyphens and trims
 * leading/trailing hyphens.
 */
function deriveFilename(id: string): string {
  const sanitizedId = sanitizeSegment(id);
  return `ext-${sanitizedId}-mod.ts`;
}

function sanitizeSegment(segment: string): string {
  return (
    segment
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "") || "x"
  );
}
