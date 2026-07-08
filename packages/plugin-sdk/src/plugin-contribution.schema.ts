import { z } from "zod";
import {
  pluginCapabilityEndpointVisibilities,
  pluginOperationNameMaxLength,
  pluginOperationNamePattern,
  pluginSubscriptionDeliveryModes,
  workflowHookEventNames,
  type PluginContribution,
} from "./plugin-contribution.types";

const nonEmptyTrimmedStringSchema = z.string().trim().min(1);
const jsonSchemaObjectSchema = z.record(z.string(), z.unknown());
const topicPatternSchema = nonEmptyTrimmedStringSchema.regex(
  /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)*(?:\.\*)?$/,
);

const eventSubscriptionRetryConfigSchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10).default(3),
    initialDelayMs: z.number().int().min(100).max(60_000).default(1_000),
    backoffMultiplier: z.number().min(1).max(10).default(2),
  })
  .strict()
  .default({
    maxAttempts: 3,
    initialDelayMs: 1_000,
    backoffMultiplier: 2,
  });

const eventSubscriptionDeadLetterConfigSchema = z
  .object({
    enabled: z.boolean(),
    reasonTemplate: nonEmptyTrimmedStringSchema.max(512).optional(),
  })
  .strict();

const requiredPermissionSchema = nonEmptyTrimmedStringSchema.regex(
  pluginOperationNamePattern,
);
export const pluginOperationNameSchema = nonEmptyTrimmedStringSchema
  .regex(pluginOperationNamePattern)
  .max(pluginOperationNameMaxLength);

const contributionBaseSchema = z.object({
  id: nonEmptyTrimmedStringSchema,
  displayName: nonEmptyTrimmedStringSchema,
  description: nonEmptyTrimmedStringSchema.optional(),
  entrypoint: nonEmptyTrimmedStringSchema.optional(),
});

export { workflowHookEventNames };

export const workflowHookEventNameSchema = z.enum(workflowHookEventNames);

export const toolContributionConfigSchema = z
  .object({
    inputSchema: jsonSchemaObjectSchema,
    outputSchema: jsonSchemaObjectSchema.optional(),
    operation: pluginOperationNameSchema.default("execute"),
    governance: nonEmptyTrimmedStringSchema.optional(),
    tier: nonEmptyTrimmedStringSchema.optional(),
  })
  .strict();

export const workflowStepContributionConfigSchema = z
  .object({
    stepType: nonEmptyTrimmedStringSchema,
    inputContract: z.union([
      nonEmptyTrimmedStringSchema,
      jsonSchemaObjectSchema,
    ]),
    operation: pluginOperationNameSchema.default("execute"),
    blocking: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export const workflowHookContributionConfigSchema = z
  .object({
    events: z.array(workflowHookEventNameSchema).min(1),
    filters: z.record(z.string(), z.unknown()).optional(),
    blocking: z.boolean().default(false),
    operation: pluginOperationNameSchema.default("handle"),
  })
  .strict();

export const eventSubscriptionContributionConfigSchema = z
  .object({
    topics: z.array(topicPatternSchema).min(1),
    filters: z.record(z.string(), z.unknown()).optional(),
    deliveryMode: z
      .enum(pluginSubscriptionDeliveryModes)
      .default("non_blocking"),
    retry: eventSubscriptionRetryConfigSchema,
    deadLetter: eventSubscriptionDeadLetterConfigSchema.optional(),
    requiredPermissions: z.array(requiredPermissionSchema).optional(),
    operation: pluginOperationNameSchema.default("handle"),
  })
  .strict();

export const capabilityEndpointContributionConfigSchema = z
  .object({
    inputSchema: jsonSchemaObjectSchema,
    outputSchema: jsonSchemaObjectSchema.optional(),
    requiredPermissions: z.array(requiredPermissionSchema).optional(),
    operation: pluginOperationNameSchema.default("invoke"),
    timeoutMs: z.number().int().positive().max(300_000).optional(),
    retryable: z.boolean().default(false),
    visibility: z.array(z.enum(pluginCapabilityEndpointVisibilities)).min(1),
  })
  .strict();

export const toolContributionSchema = contributionBaseSchema
  .extend({
    type: z.literal("tool"),
    config: toolContributionConfigSchema,
  })
  .strict();

export const workflowStepContributionSchema = contributionBaseSchema
  .extend({
    type: z.literal("workflow.step"),
    config: workflowStepContributionConfigSchema,
  })
  .strict();

export const workflowHookContributionSchema = contributionBaseSchema
  .extend({
    type: z.literal("workflow.hook"),
    config: workflowHookContributionConfigSchema,
  })
  .strict();

export const eventSubscriptionContributionSchema = contributionBaseSchema
  .extend({
    type: z.literal("event.subscription"),
    config: eventSubscriptionContributionConfigSchema,
  })
  .strict();

export const capabilityEndpointContributionSchema = contributionBaseSchema
  .extend({
    type: z.literal("capability.endpoint"),
    config: capabilityEndpointContributionConfigSchema,
  })
  .strict();

export const legacySpecialStepContributionSchema = contributionBaseSchema
  .extend({
    type: z.literal("special_step"),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const pluginContributionSchema = z.discriminatedUnion("type", [
  toolContributionSchema,
  workflowStepContributionSchema,
  workflowHookContributionSchema,
  eventSubscriptionContributionSchema,
  capabilityEndpointContributionSchema,
  legacySpecialStepContributionSchema,
]);

export function parsePluginContribution(value: unknown): PluginContribution {
  return pluginContributionSchema.parse(value);
}
