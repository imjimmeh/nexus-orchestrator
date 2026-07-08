import { z } from "zod";
import {
  HarnessExtensionAssetSchema,
  HarnessHookAssetSchema,
  HarnessPluginSchema,
} from "./harness-assets.schema";

export { HarnessHookEventSchema } from "./harness-assets.schema";
export {
  HarnessAssetSourceSchema,
  HarnessExtensionAssetSchema,
  HarnessHookAssetSchema,
  HarnessPluginSchema,
} from "./harness-assets.schema";

export const HarnessSettingsContributionSchema = z.object({
  env: z.record(z.string(), z.string()).optional(),
  permissions: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
  outputStyle: z.string().min(1).max(128).optional(),
});

export const HarnessContributionsSchema = z.object({
  hooks: z.array(HarnessHookAssetSchema),
  extensions: z.array(HarnessExtensionAssetSchema),
  plugins: z.array(HarnessPluginSchema),
  settings: HarnessSettingsContributionSchema,
});

/**
 * Author-facing input: any subset of a contributions bundle. Differs from
 * HarnessContributionsSchema (the resolved bundle) by making every group
 * optional, so a profile/step/skill can contribute just hooks, just settings, etc.
 */
export const HarnessContributionsInputSchema = z.object({
  hooks: z.array(HarnessHookAssetSchema).optional(),
  extensions: z.array(HarnessExtensionAssetSchema).optional(),
  plugins: z.array(HarnessPluginSchema).optional(),
  settings: HarnessSettingsContributionSchema.optional(),
});
