import { z } from "zod";
import { pluginContributionSchema } from "./plugin-contribution.schema";
import {
  pluginIsolationModes,
  pluginLifecycleStates,
  pluginTrustLevels,
  type PluginManifest,
} from "./plugin-manifest.types";

const nonEmptyTrimmedStringSchema = z.string().trim().min(1);

export const pluginIsolationModeSchema = z.enum(pluginIsolationModes);
export const pluginTrustLevelSchema = z.enum(pluginTrustLevels);
export const pluginLifecycleStateSchema = z.enum(pluginLifecycleStates);

export const pluginNexusCompatibilitySchema = z
  .object({
    pluginApiVersion: nonEmptyTrimmedStringSchema,
    minVersion: nonEmptyTrimmedStringSchema,
    maxVersion: nonEmptyTrimmedStringSchema.optional(),
  })
  .strict();

export const pluginEntrypointsSchema = z
  .object({
    main: nonEmptyTrimmedStringSchema,
    worker: nonEmptyTrimmedStringSchema.optional(),
  })
  .strict();

export const pluginPermissionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("network"),
      hosts: z.array(nonEmptyTrimmedStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("filesystem"),
      access: z.enum(["read", "write"]),
      paths: z.array(nonEmptyTrimmedStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("environment"),
      variables: z.array(nonEmptyTrimmedStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("secrets"),
      names: z.array(nonEmptyTrimmedStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("internal_capability"),
      capabilities: z.array(nonEmptyTrimmedStringSchema).min(1),
    })
    .strict(),
]);

export const pluginManifestContributionSchema = pluginContributionSchema;

export const pluginManifestSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    name: nonEmptyTrimmedStringSchema,
    version: nonEmptyTrimmedStringSchema,
    description: nonEmptyTrimmedStringSchema.optional(),
    author: nonEmptyTrimmedStringSchema.optional(),
    packageName: nonEmptyTrimmedStringSchema.optional(),
    packageVersion: nonEmptyTrimmedStringSchema.optional(),
    checksum: nonEmptyTrimmedStringSchema.optional(),
    signature: nonEmptyTrimmedStringSchema.optional(),
    nexusCompatibility: pluginNexusCompatibilitySchema,
    entrypoints: pluginEntrypointsSchema,
    isolationModes: z.array(pluginIsolationModeSchema).min(1),
    permissions: z.array(pluginPermissionSchema),
    contributions: z.array(pluginManifestContributionSchema).min(1),
  })
  .strict()
  .superRefine(({ contributions }, context) => {
    const seenIds = new Set<string>();

    for (const [index, contribution] of contributions.entries()) {
      if (seenIds.has(contribution.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate contribution id: ${contribution.id}`,
          path: ["contributions", index, "id"],
        });
        continue;
      }

      seenIds.add(contribution.id);
    }
  });

export function parsePluginManifest(value: unknown): PluginManifest {
  return pluginManifestSchema.parse(value);
}
