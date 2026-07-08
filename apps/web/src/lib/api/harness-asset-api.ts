import type { ApiClient } from "./client";
import type {
  CreateHarnessAssetRequest,
  HarnessAssetRecord,
  HarnessAssetSource,
  ImportConfirmResult,
  ImportPreviewResult,
} from "./harness-asset-api.types";

/**
 * Persist a new immutable harness asset.
 *
 * POST /harness/assets
 */
export function createHarnessAsset(
  client: ApiClient,
  body: CreateHarnessAssetRequest,
): Promise<HarnessAssetRecord> {
  return client.post<HarnessAssetRecord>("/harness/assets", body);
}

/**
 * List persisted harness assets, optionally filtered by scope.
 *
 * GET /harness/assets?scopeNodeId=<id>
 * Omit `scopeNodeId` to retrieve platform-global assets.
 */
export function listHarnessAssets(
  client: ApiClient,
  scopeNodeId?: string,
): Promise<HarnessAssetRecord[]> {
  return client.get<HarnessAssetRecord[]>("/harness/assets", {
    params: scopeNodeId ? { scopeNodeId } : undefined,
  });
}

/**
 * Preview an external harness asset import WITHOUT persisting it.
 *
 * POST /harness/assets/import
 *
 * Returns the resolved manifest summary, canonical checksum, and pinned
 * source. The API never includes secret env / header values in the response.
 */
export function previewImportAsset(
  client: ApiClient,
  source: HarnessAssetSource,
  scopeNodeId?: string,
): Promise<ImportPreviewResult> {
  return client.post<ImportPreviewResult>("/harness/assets/import", {
    source,
    ...(scopeNodeId !== undefined ? { scopeNodeId } : {}),
  });
}

/**
 * Confirm an external harness asset import and persist the immutable asset row.
 *
 * POST /harness/assets/import/confirm
 *
 * Returns `{ id }` of the newly created asset row.
 */
export function confirmImportAsset(
  client: ApiClient,
  source: HarnessAssetSource,
  scopeNodeId?: string,
): Promise<ImportConfirmResult> {
  return client.post<ImportConfirmResult>("/harness/assets/import/confirm", {
    source,
    ...(scopeNodeId !== undefined ? { scopeNodeId } : {}),
  });
}
