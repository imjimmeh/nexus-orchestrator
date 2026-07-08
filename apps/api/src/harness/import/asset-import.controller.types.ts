import type { HarnessAssetSource } from '@nexus/core';
import type { PrepareImportResult } from './asset-importer.service.types.js';

/**
 * Request body for both `POST /harness/assets/import` (preview)
 * and `POST /harness/assets/import/confirm` (persist).
 */
export interface ImportRequestBody {
  /** Source descriptor for the asset to import. */
  source: HarnessAssetSource;
  /** Optional scope node to associate with the asset row on confirm. */
  scopeNodeId?: string;
}

/**
 * Response from `POST /harness/assets/import` (preview).
 *
 * A safe, non-persisting summary: manifest, checksum, and pinned source.
 * NEVER includes resolved secret env / header values.
 */
export type PreviewResponse = Omit<PrepareImportResult, 'bundleSizeBytes'>;

/**
 * Response from `POST /harness/assets/import/confirm` (persist).
 */
export interface ConfirmResponse {
  /** The id of the newly persisted asset row. */
  id: string;
}
