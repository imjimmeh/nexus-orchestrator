import type { z } from 'zod';
import type {
  HarnessHookAssetSchema,
  HarnessExtensionAssetSchema,
  HarnessPluginSchema,
} from '@nexus/core';
import type { HarnessAssetSource } from '@nexus/core';

/**
 * The authored payload for a `hook_script` asset.
 * Validated against `HarnessHookAssetSchema`.
 */
export type HookScriptPayload = z.infer<typeof HarnessHookAssetSchema>;

/**
 * The bundle payload for an `extension` asset.
 * Only `runtime` and `entry` are required; extra fields are stored as-is.
 */
export type ExtensionBundlePayload = Pick<
  z.infer<typeof HarnessExtensionAssetSchema>,
  'runtime' | 'entry'
> &
  Record<string, unknown>;

/**
 * The bundle payload for a `plugin` asset.
 * Must include a `capabilities` key so the hydration projection can read it.
 */
export type PluginBundlePayload = Pick<
  z.infer<typeof HarnessPluginSchema>,
  'capabilities'
> &
  Record<string, unknown>;

/** Discriminated union input for `HarnessAssetService.createAsset`. */
export type CreateAssetInput =
  | {
      kind: 'hook_script';
      name: string;
      version: string;
      source: HarnessAssetSource;
      payload: HookScriptPayload;
      scopeNodeId: string | null;
    }
  | {
      kind: 'extension';
      name: string;
      version: string;
      source: HarnessAssetSource;
      payload: ExtensionBundlePayload;
      scopeNodeId: string | null;
    }
  | {
      kind: 'plugin';
      name: string;
      version: string;
      source: HarnessAssetSource;
      payload: PluginBundlePayload;
      scopeNodeId: string | null;
    };
