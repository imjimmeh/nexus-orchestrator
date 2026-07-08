import { api } from "@/lib/api/client";
import { createHarnessAsset } from "@/lib/api/harness-asset-api";
import type {
  ExtensionDraft,
  SaveExtensionAsAssetCallbacks,
} from "./HarnessAssetEditor.types";

/**
 * Persists an authored extension draft as a reusable harness asset via
 * `POST /harness/assets`. Updates status + refs via the provided callbacks.
 *
 * Extracted from `useHarnessAssetEditor` to keep the hook under the
 * max-lines-per-function lint limit.
 */
export async function persistExtensionAsDraft(
  draftId: string,
  assetName: string,
  version: string,
  extensionDrafts: ExtensionDraft[],
  scopeNodeId: string | undefined,
  callbacks: SaveExtensionAsAssetCallbacks,
): Promise<void> {
  const draft = extensionDrafts.find((e) => e.id === draftId);
  if (!draft) return;

  callbacks.onStatusChange(draftId, { state: "pending" });

  try {
    const created = await createHarnessAsset(api, {
      kind: "extension",
      name: assetName,
      version,
      source: { kind: "authored" },
      payload: {
        runtime: draft.runtime,
        entry: draft.entry,
        ...(draft.moduleSource ? { moduleSource: draft.moduleSource } : {}),
      },
      scopeNodeId: scopeNodeId ?? null,
    });

    callbacks.onRefAdded(created.id);
    callbacks.onAssetCreated(created);
    callbacks.onStatusChange(draftId, { state: "idle" });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to save asset.";
    callbacks.onStatusChange(draftId, { state: "error", message });
  }
}
