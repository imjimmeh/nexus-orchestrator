import { Injectable } from '@nestjs/common';
import { HarnessAssetRepository } from './harness-asset.repository.js';
import { computeAssetChecksum } from '@nexus/core';
import {
  buildHookBundle,
  buildExtensionBundle,
  buildPluginBundle,
} from './bundle-builders.js';
import type { HarnessAssetEntity } from './harness-asset.entity.js';
import type { CreateAssetInput } from './harness-asset.service.types.js';

export type { CreateAssetInput } from './harness-asset.service.types.js';

@Injectable()
export class HarnessAssetService {
  constructor(private readonly repo: HarnessAssetRepository) {}

  /**
   * Validates the authored payload, computes the canonical checksum, and
   * persists an immutable asset row.
   *
   * Throws `UnprocessableEntityException` when the payload is invalid.
   * Never logs bundle contents.
   */
  async createAsset(input: CreateAssetInput): Promise<HarnessAssetEntity> {
    const bundle = this.buildBundle(input);

    const checksum = computeAssetChecksum(bundle);

    return this.repo.create({
      kind: input.kind,
      name: input.name,
      version: input.version,
      source: input.source,
      checksum,
      bundle,
      scopeNodeId: input.scopeNodeId,
    });
  }

  /**
   * Returns all assets belonging to `scopeNodeId`.
   * Pass `null` to retrieve platform-global assets.
   */
  listAssets(scopeNodeId: string | null): Promise<HarnessAssetEntity[]> {
    return this.repo.findByScope(scopeNodeId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildBundle(input: CreateAssetInput): string {
    if (input.kind === 'hook_script') {
      return buildHookBundle(input.payload);
    }
    if (input.kind === 'extension') {
      return buildExtensionBundle(input.payload);
    }
    return buildPluginBundle(input.payload);
  }
}
