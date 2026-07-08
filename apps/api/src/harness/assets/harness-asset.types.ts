import type { HarnessAssetEntity } from './harness-asset.entity';

/** The discriminant for the `kind` column on a harness asset row. */
export type HarnessAssetKind = 'plugin' | 'extension' | 'hook_script';

/** Fields required to create a new (immutable) asset row. */
export type CreateHarnessAssetInput = Omit<
  HarnessAssetEntity,
  'id' | 'createdAt'
>;
