/** Discriminant for a persisted harness asset row. */
export type HarnessAssetKind = "plugin" | "extension" | "hook_script";

/** The provenance descriptor stored on each asset row. */
export type HarnessAssetSource =
  | { kind: "authored" }
  | { kind: "git"; repo: string; ref: string; subdir?: string }
  | { kind: "registry"; name: string; version: string };

/**
 * A persisted harness asset as returned by `GET /harness/assets` and
 * `POST /harness/assets`.
 */
export interface HarnessAssetRecord {
  id: string;
  kind: HarnessAssetKind;
  name: string;
  version: string;
  source: HarnessAssetSource;
  checksum: string;
  /** JSON-encoded bundle payload — not decoded by the web client. */
  bundle: string;
  scopeNodeId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Import flow types (preview + confirm)
// ---------------------------------------------------------------------------

/**
 * Safe manifest preview returned by `POST /harness/assets/import`.
 *
 * Secret env / header values resolved from the source are NEVER included.
 */
export interface ImportPreviewResult {
  /** Asset kind detected during vetting. */
  kind: Extract<HarnessAssetKind, "plugin" | "extension">;
  /**
   * Safe manifest summary — CC plugin: parsed plugin.json without secrets;
   * PI extension: `{ entry }`.  NEVER includes resolved secret values.
   */
  manifest: Record<string, unknown>;
  /** Canonical content-hash: `sha256:<hex>` over the normalised bundle. */
  checksum: string;
  /**
   * The source descriptor with the mutable ref replaced by the resolved
   * commit SHA / digest, enabling the confirm step to re-fetch
   * deterministically.
   */
  pinnedSource: HarnessAssetSource;
}

/**
 * Response from `POST /harness/assets/import/confirm`.
 */
export interface ImportConfirmResult {
  /** The id of the newly persisted asset row. */
  id: string;
}

// ---------------------------------------------------------------------------
// Authored-asset creation types
// ---------------------------------------------------------------------------

/**
 * Payload sent to `POST /harness/assets` for a `hook_script` asset.
 * Mirrors `HarnessHookAssetSchema` from `@nexus/core`.
 */
export type HookScriptPayload = Record<string, unknown>;

/**
 * Payload sent to `POST /harness/assets` for an `extension` asset.
 * Must include `runtime` and `entry`; `moduleSource` required for ts-module.
 */
export interface ExtensionPayload {
  runtime: "ts-module" | "package";
  entry: string;
  moduleSource?: string;
  [key: string]: unknown;
}

/**
 * Payload sent to `POST /harness/assets` for a `plugin` asset.
 * Must include `capabilities`.
 */
export type PluginPayload = {
  capabilities: Record<string, unknown>;
  [key: string]: unknown;
};

/** Discriminated union request body for `POST /harness/assets`. */
export type CreateHarnessAssetRequest =
  | {
      kind: "hook_script";
      name: string;
      version: string;
      source: HarnessAssetSource;
      payload: HookScriptPayload;
      scopeNodeId: string | null;
    }
  | {
      kind: "extension";
      name: string;
      version: string;
      source: HarnessAssetSource;
      payload: ExtensionPayload;
      scopeNodeId: string | null;
    }
  | {
      kind: "plugin";
      name: string;
      version: string;
      source: HarnessAssetSource;
      payload: PluginPayload;
      scopeNodeId: string | null;
    };
