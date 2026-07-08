import {
  pluginIsolationModes,
  pluginLifecycleStates,
  pluginTrustLevels,
} from '@nexus/plugin-sdk';
import { z } from 'zod';

const versionSchema = z.string().trim().min(1);
const pluginSourceTypes = ['package', 'local', 'bundled'] as const;
const installPluginTrustLevels = [
  'bundled',
  'local_trusted',
  'third_party',
] as const;
const queryBooleanSchema = z.union([
  z.boolean(),
  z.literal('true').transform(() => true),
  z.literal('false').transform(() => false),
]);

export const listPluginsSchema = z
  .object({
    state: z.enum(pluginLifecycleStates).optional(),
    enabled: queryBooleanSchema.optional(),
    trustLevel: z.enum(pluginTrustLevels).optional(),
  })
  .strict();

export const inspectPluginSchema = z
  .object({
    version: versionSchema,
  })
  .strict();

export const installPluginSchema = z
  .object({
    manifest: z.unknown(),
    source: z.string().trim().min(1),
    sourceType: z.enum(pluginSourceTypes).optional(),
    trustLevel: z.enum(installPluginTrustLevels).optional(),
    isolationMode: z.enum(pluginIsolationModes).optional(),
  })
  .strict();

export const scanPluginSchema = z
  .object({
    version: versionSchema,
    scanResult: z.record(z.string(), z.unknown()).optional(),
    compatibilityResult: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const enablePluginSchema = z
  .object({
    version: versionSchema,
  })
  .strict();

export const disablePluginSchema = z
  .object({
    version: versionSchema,
  })
  .strict();

export const quarantinePluginSchema = z
  .object({
    version: versionSchema,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
