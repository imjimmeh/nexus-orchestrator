import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import {
  HarnessHookAssetSchema,
  HarnessExtensionAssetSchema,
  HarnessPluginSchema,
} from '@nexus/core';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Zod schema for validating the bundle payload of an extension asset.
 *
 * `runtime` and `entry` are always required. `moduleSource` is a first-class
 * field forwarded verbatim to the bundle so the PI harness engine can stage
 * it as a `.ts` file at session creation time. For `ts-module` assets,
 * `moduleSource` is required (a module with no code is invalid). For `package`
 * assets it may be absent.  Extra fields are passed through unchanged.
 */
const ExtensionBundleSchema = HarnessExtensionAssetSchema.pick({
  runtime: true,
  entry: true,
  moduleSource: true,
})
  .catchall(z.unknown())
  .superRefine((val, ctx) => {
    if (
      val.runtime === 'ts-module' &&
      (typeof val.moduleSource !== 'string' || val.moduleSource.length === 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['moduleSource'],
        message:
          'moduleSource is required for ts-module extensions — a module with no source code is invalid',
      });
    }
  });

/**
 * Zod schema for validating the bundle payload of a plugin asset.
 *
 * Enforces the top-level `capabilities` key so that the hydration projection
 * (`entityToPlugin`) can always read `manifest['capabilities']`.
 */
const PluginBundleSchema = HarnessPluginSchema.pick({
  capabilities: true,
}).catchall(z.unknown());

/** Human-readable error message prefix for validation failures. */
const INVALID_ASSET_PREFIX = 'Invalid asset payload';

// ---------------------------------------------------------------------------
// Exported bundle builder functions
// ---------------------------------------------------------------------------

/**
 * Validates `payload` against the hook-asset schema and serialises it to a
 * JSON string ready for `harness_assets.bundle`.
 *
 * Throws `UnprocessableEntityException` on validation failure.
 * This is the single source of truth for hook-bundle serialization — reused
 * by both the authored (`HarnessAssetService`) and import (`AssetImporterService`)
 * paths so that the stored shape is always identical.
 */
export function buildHookBundle(payload: unknown): string {
  const result = HarnessHookAssetSchema.safeParse(payload);
  if (!result.success) {
    throw new UnprocessableEntityException(
      `${INVALID_ASSET_PREFIX}: ${result.error.message}`,
    );
  }
  return JSON.stringify(result.data);
}

/**
 * Validates `payload` against the extension-bundle schema and serialises it to a
 * JSON string ready for `harness_assets.bundle`.
 *
 * Throws `UnprocessableEntityException` on validation failure.
 * This is the single source of truth for extension-bundle serialization — reused
 * by both the authored (`HarnessAssetService`) and import (`AssetImporterService`)
 * paths so that the stored shape is always identical.
 */
export function buildExtensionBundle(payload: unknown): string {
  const result = ExtensionBundleSchema.safeParse(payload);
  if (!result.success) {
    throw new UnprocessableEntityException(
      `${INVALID_ASSET_PREFIX}: ${result.error.message}`,
    );
  }
  // The schema uses `.catchall(z.unknown())`, so `result.data` already
  // contains all keys from the original payload — no spread merge needed.
  return JSON.stringify(result.data);
}

/**
 * Validates `payload` against the plugin-bundle schema and serialises it to a
 * JSON string ready for `harness_assets.bundle`.
 *
 * Throws `UnprocessableEntityException` on validation failure.
 * This is the single source of truth for plugin-bundle serialization — reused
 * by both the authored (`HarnessAssetService`) and import (`AssetImporterService`)
 * paths so that the stored shape is always identical.
 */
export function buildPluginBundle(payload: unknown): string {
  const result = PluginBundleSchema.safeParse(payload);
  if (!result.success) {
    throw new UnprocessableEntityException(
      `${INVALID_ASSET_PREFIX}: ${result.error.message}`,
    );
  }
  // The schema uses `.catchall(z.unknown())`, so `result.data` already
  // contains all keys from the original payload — no spread merge needed.
  return JSON.stringify(result.data);
}
