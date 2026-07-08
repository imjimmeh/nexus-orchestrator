import { z } from "zod";
import type { HarnessHookAsset } from "../../interfaces/harness-asset.types";

/** Zod mirror of the HarnessHookEvent union — defined here to avoid circular imports. */
export const HarnessHookEventSchema = z.enum([
  "session_start",
  "session_end",
  "pre_tool_use",
  "post_tool_use",
  "user_prompt_submit",
]);

export const HarnessAssetSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("authored") }),
  z.object({
    kind: z.literal("git"),
    repo: z.string().min(1).max(2048),
    ref: z.string().min(1).max(256),
    subdir: z.string().min(1).max(1024).optional(),
  }),
  z.object({
    kind: z.literal("registry"),
    name: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
  }),
]);

const HookScriptBodySchema = z.object({
  language: z.enum(["bash", "node", "python"]),
  source: z.string().min(1),
});

const HookBaseSchema = z.object({
  event: HarnessHookEventSchema,
  matcher: z.string().min(1).max(256).optional(),
  timeoutMs: z.number().int().positive().max(600000).optional(),
});

const HookScriptVariantSchema = HookBaseSchema.extend({
  script: HookScriptBodySchema,
});

const HookCommandVariantSchema = HookBaseSchema.extend({
  command: z.string().min(1).max(4096),
});

/**
 * A hook asset. Exactly one of `script` or `command` must be present.
 *
 * The schema is typed as `z.ZodType<HarnessHookAsset>` to produce the correct
 * union inference for downstream consumers. The "both present" case is rejected
 * by a raw-input preprocess that checks before either branch parses.
 */
function hasScriptField(val: Record<string, unknown>): boolean {
  return "script" in val && val["script"] !== undefined;
}

function hasCommandField(val: Record<string, unknown>): boolean {
  return "command" in val && val["command"] !== undefined;
}

export const HarnessHookAssetSchema: z.ZodType<HarnessHookAsset> = z
  .record(z.string(), z.unknown())
  .superRefine((val, ctx) => {
    const hasScript = hasScriptField(val);
    const hasCommand = hasCommandField(val);
    if (hasScript && hasCommand) {
      ctx.addIssue({
        code: "custom",
        message:
          "A hook asset must have exactly one of 'script' or 'command', not both",
        path: ["command"],
      });
    }
    if (!hasScript && !hasCommand) {
      ctx.addIssue({
        code: "custom",
        message: "A hook asset must have exactly one of 'script' or 'command'",
      });
    }
  })
  .pipe(z.union([HookScriptVariantSchema, HookCommandVariantSchema]));

export const HarnessExtensionAssetSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  runtime: z.enum(["ts-module", "package"]),
  entry: z.string().min(1).max(1024),
  source: HarnessAssetSourceSchema,
  checksum: z.string().min(1).max(512),
  /**
   * TypeScript module source for `ts-module` extensions. Required when
   * `runtime` is `"ts-module"`; absent for `"package"` assets.
   * Never logged — treated as opaque bytes to write to disk.
   */
  moduleSource: z.string().min(1).optional(),
});

export const HarnessPluginSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  version: z.string().min(1).max(128),
  source: HarnessAssetSourceSchema,
  checksum: z.string().min(1).max(512),
  capabilities: z.object({
    hooks: z.array(HarnessHookAssetSchema).optional(),
    slashCommands: z.array(z.string().min(1).max(256)).optional(),
    subagents: z.array(z.string().min(1).max(256)).optional(),
    mcpServerRefs: z.array(z.string().min(1).max(256)).optional(),
  }),
  manifest: z.record(z.string(), z.unknown()),
});
