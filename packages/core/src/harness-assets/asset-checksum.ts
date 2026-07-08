import { createHash } from "node:crypto";

/**
 * Canonical asset checksum algorithm — single source of truth.
 *
 * Both the asset-creation path (apps/api) and the engine-side re-verify path
 * (harness-engine-pi, harness-engine-claude-code) import and call this
 * function so that the stored checksum always matches the recomputed one.
 *
 * It lives in `@nexus/core` — the leaf package every consumer already depends
 * on — rather than in the in-container `@nexus/harness-runtime` host, so the
 * orchestration control plane does not have to pull the harness runtime into
 * its build just to hash a bundle.
 *
 * Algorithm: SHA-256 over the raw bundle string (UTF-8), hex-encoded,
 * prefixed with "sha256:" for readability and future algorithm negotiation.
 *
 * @param bundle - The raw bundle string exactly as stored in `harness_assets.bundle`.
 * @returns A checksum string in the form `sha256:<hex>`.
 */
export function computeAssetChecksum(bundle: string): string {
  const hex = createHash("sha256").update(bundle, "utf8").digest("hex");
  return `sha256:${hex}`;
}
