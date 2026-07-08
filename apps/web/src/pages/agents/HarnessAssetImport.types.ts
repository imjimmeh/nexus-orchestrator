import type {
  HarnessAssetKind,
  HarnessAssetSource,
} from "@/lib/api/harness-asset-api.types";

/**
 * The source for an import — mirrors the git and registry variants from
 * `HarnessAssetSource` but without the `authored` variant which has no
 * external repo.
 */
export type ImportSource =
  | { kind: "git"; repo: string; ref: string; subdir?: string }
  | { kind: "registry"; name: string; version: string };

/**
 * The manifest preview returned by `POST /harness/assets/import`.
 * Contains only safe fields; secret env / header values are never included.
 */
export interface ImportPreviewResult {
  /** Asset kind detected during vetting. */
  kind: Extract<HarnessAssetKind, "plugin" | "extension">;
  /** Safe manifest summary — no resolved secret values. */
  manifest: Record<string, unknown>;
  /** Canonical content-hash: `sha256:<hex>` over the normalised bundle. */
  checksum: string;
  /**
   * The source descriptor with the mutable ref replaced by the resolved commit
   * SHA / digest, enabling the confirm step to re-fetch deterministically.
   */
  pinnedSource: HarnessAssetSource;
}

/**
 * The response returned by `POST /harness/assets/import/confirm`.
 */
export interface ImportConfirmResult {
  /** The id of the newly persisted asset row. */
  id: string;
}

/**
 * Props for the `HarnessAssetImport` component.
 *
 * On confirm success the caller receives the new asset id and the kind so it
 * can append the id to the appropriate ref list (`pluginRefs` or
 * `extensionRefs`).
 */
export interface HarnessAssetImportProps {
  /**
   * Optional scope node to associate with the persisted asset row on confirm.
   */
  readonly scopeNodeId?: string;
  /**
   * Called when the import is successfully confirmed.
   *
   * @param id   - The newly persisted asset id.
   * @param kind - Asset kind (`"plugin"` | `"extension"`).
   */
  readonly onImported: (
    id: string,
    kind: Extract<HarnessAssetKind, "plugin" | "extension">,
  ) => void;
}

/**
 * Discriminated state machine for the import flow.
 *
 * - `idle`        — no interaction yet; input is empty.
 * - `previewing`  — preview API call in flight.
 * - `previewed`   — preview resolved; manifest + pinned ref visible.
 * - `confirming`  — confirm API call in flight.
 * - `confirmed`   — confirm resolved; id attached; flow complete.
 * - `error`       — a preview or confirm call returned an error.
 */
export type ImportFlowState =
  | { phase: "idle" }
  | { phase: "previewing" }
  | {
      phase: "previewed";
      preview: ImportPreviewResult;
    }
  | {
      phase: "confirming";
      preview: ImportPreviewResult;
    }
  | {
      phase: "confirmed";
      id: string;
    }
  | { phase: "error"; message: string };

/** Return type of `useHarnessAssetImport`. */
export interface UseHarnessAssetImportResult {
  /** The raw user-entered source string (JSON or structured). */
  sourceInput: string;
  /** Setter for `sourceInput` — bound to the text area's onChange. */
  setSourceInput: (value: string) => void;
  /** Current phase of the import state machine. */
  state: ImportFlowState;
  /** Trigger preview; parses `sourceInput` before calling the API. */
  preview: () => Promise<void>;
  /** Trigger confirm using the previewed result. */
  confirm: () => Promise<void>;
  /** Reset the flow back to idle (keeps the source input). */
  reset: () => void;
}
