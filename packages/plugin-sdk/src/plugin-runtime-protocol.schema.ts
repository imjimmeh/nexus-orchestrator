import { z } from "zod";
import {
  pluginCapabilityEndpointVisibilities,
  pluginOperationNameMaxLength,
  pluginOperationNamePattern,
  pluginSubscriptionDeliveryModes,
  workflowHookEventNames,
} from "./plugin-contribution.types";
import {
  PLUGIN_RUNTIME_PROTOCOL_VERSION,
  type PluginRuntimeJsonValue,
  type PluginRuntimeProtocolMessage,
} from "./plugin-runtime-protocol.types";

const protocolVersionSchema = z.literal(PLUGIN_RUNTIME_PROTOCOL_VERSION);
const pluginRuntimeModeSchema = z.enum(["none", "worker_process", "container"]);

// Keep control-plane metadata bounded so protocol messages stay cheap to parse and log safely.
export const PLUGIN_RUNTIME_PROTOCOL_METADATA_MAX_BYTES = 4096;
export const PLUGIN_RUNTIME_PROTOCOL_PAYLOAD_MAX_BYTES = 4096;
export const PLUGIN_RUNTIME_PROTOCOL_JSON_MAX_DEPTH = 5;
export const PLUGIN_RUNTIME_PROTOCOL_IDENTIFIER_MAX_LENGTH =
  pluginOperationNameMaxLength;
export const PLUGIN_RUNTIME_PROTOCOL_ERROR_MESSAGE_MAX_LENGTH = 2048;

const textEncoder = new TextEncoder();

const dottedIdentifierPattern =
  /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)*$/;
const tokenIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const operationNamePattern = pluginOperationNamePattern;
const errorCodePattern = /^[A-Z][A-Z0-9_]*$/;

function createIdentifierSchema(pattern: RegExp): z.ZodString {
  return z
    .string()
    .min(1)
    .max(PLUGIN_RUNTIME_PROTOCOL_IDENTIFIER_MAX_LENGTH)
    .regex(pattern);
}

const pluginIdSchema = createIdentifierSchema(dottedIdentifierPattern);
const peerIdSchema = createIdentifierSchema(dottedIdentifierPattern);
const correlationIdSchema = createIdentifierSchema(tokenIdentifierPattern);
const contributionIdSchema = createIdentifierSchema(dottedIdentifierPattern);
const operationNameSchema = createIdentifierSchema(operationNamePattern);
const eventIdentifierSchema = createIdentifierSchema(dottedIdentifierPattern);
const topicIdentifierSchema = z
  .string()
  .min(1)
  .max(PLUGIN_RUNTIME_PROTOCOL_IDENTIFIER_MAX_LENGTH)
  .regex(
    /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)*(?:\.\*)?$/,
  );
const errorCodeSchema = createIdentifierSchema(errorCodePattern);
const errorMessageSchema = z
  .string()
  .min(1)
  .max(PLUGIN_RUNTIME_PROTOCOL_ERROR_MESSAGE_MAX_LENGTH)
  .refine(
    (value) => value.trim() === value,
    "String must not include leading or trailing whitespace",
  );

function isJsonCompatible(
  value: unknown,
  maxDepth: number,
  seen: WeakSet<object>,
  depth = 0,
): value is PluginRuntimeJsonValue {
  if (depth > maxDepth) {
    return false;
  }

  if (value === null) {
    return true;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object") {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        return false;
      }
    }

    return value.every((item) =>
      isJsonCompatible(item, maxDepth, seen, depth + 1),
    );
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every((item) =>
    isJsonCompatible(item, maxDepth, seen, depth + 1),
  );
}

function getSerializedUtf8ByteLength(
  value: PluginRuntimeJsonValue,
): number | null {
  try {
    return textEncoder.encode(JSON.stringify(value)).length;
  } catch {
    return null;
  }
}

function createBoundedJsonSchema(
  maxBytes: number,
): z.ZodType<PluginRuntimeJsonValue> {
  return z.unknown().superRefine((value, context) => {
    if (
      !isJsonCompatible(
        value,
        PLUGIN_RUNTIME_PROTOCOL_JSON_MAX_DEPTH,
        new WeakSet(),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Value must be JSON-compatible and within protocol depth limits",
      });
      return;
    }

    const serializedByteLength = getSerializedUtf8ByteLength(value);

    if (serializedByteLength === null || serializedByteLength > maxBytes) {
      context.addIssue({
        code: "custom",
        message: `Value must serialize to at most ${maxBytes} UTF-8 bytes`,
      });
    }
  }) as z.ZodType<PluginRuntimeJsonValue>;
}

const payloadSchema = createBoundedJsonSchema(
  PLUGIN_RUNTIME_PROTOCOL_PAYLOAD_MAX_BYTES,
);
const metadataSchema = z
  .record(z.string(), payloadSchema)
  .superRefine((value, context) => {
    const serializedByteLength = getSerializedUtf8ByteLength(value);

    if (
      serializedByteLength === null ||
      serializedByteLength > PLUGIN_RUNTIME_PROTOCOL_METADATA_MAX_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: `Value must serialize to at most ${PLUGIN_RUNTIME_PROTOCOL_METADATA_MAX_BYTES} UTF-8 bytes`,
      });
    }
  });

const workflowHookEventNameSchema = z.enum(workflowHookEventNames);
const runtimeJsonObjectSchema = z.record(z.string(), payloadSchema);
const runtimeContributionBaseSchema = z.object({
  id: contributionIdSchema,
  displayName: z.string().min(1).max(256),
  description: z.string().min(1).max(2048).optional(),
  entrypoint: createIdentifierSchema(tokenIdentifierPattern).optional(),
});

const runtimeToolContributionConfigSchema = z
  .object({
    inputSchema: runtimeJsonObjectSchema,
    outputSchema: runtimeJsonObjectSchema.optional(),
    operation: operationNameSchema.default("execute"),
    governance: z.string().min(1).max(256).optional(),
    tier: z.string().min(1).max(256).optional(),
  })
  .strict();

const runtimeWorkflowStepContributionConfigSchema = z
  .object({
    stepType: contributionIdSchema,
    inputContract: z.union([
      z.string().min(1).max(256),
      runtimeJsonObjectSchema,
    ]),
    operation: operationNameSchema.default("execute"),
    blocking: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

const runtimeWorkflowHookContributionConfigSchema = z
  .object({
    events: z.array(workflowHookEventNameSchema).min(1),
    filters: metadataSchema.optional(),
    blocking: z.boolean().default(false),
    operation: operationNameSchema.default("handle"),
  })
  .strict();

const runtimeEventSubscriptionContributionConfigSchema = z
  .object({
    topics: z.array(topicIdentifierSchema).min(1),
    filters: metadataSchema.optional(),
    deliveryMode: z
      .enum(pluginSubscriptionDeliveryModes)
      .default("non_blocking"),
    retry: z
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
      }),
    deadLetter: z
      .object({
        enabled: z.boolean(),
        reasonTemplate: z.string().min(1).max(512).optional(),
      })
      .strict()
      .optional(),
    requiredPermissions: z
      .array(createIdentifierSchema(operationNamePattern))
      .optional(),
    operation: operationNameSchema.default("handle"),
  })
  .strict();

const runtimeCapabilityEndpointContributionConfigSchema = z
  .object({
    inputSchema: runtimeJsonObjectSchema,
    outputSchema: runtimeJsonObjectSchema.optional(),
    requiredPermissions: z
      .array(createIdentifierSchema(operationNamePattern))
      .optional(),
    operation: operationNameSchema.default("invoke"),
    timeoutMs: z.number().int().positive().max(300_000).optional(),
    retryable: z.boolean().default(false),
    visibility: z.array(z.enum(pluginCapabilityEndpointVisibilities)).min(1),
  })
  .strict();

const pluginRuntimeContributionSchema = z.discriminatedUnion("type", [
  runtimeContributionBaseSchema
    .extend({
      type: z.literal("tool"),
      config: runtimeToolContributionConfigSchema,
    })
    .strict(),
  runtimeContributionBaseSchema
    .extend({
      type: z.literal("workflow.step"),
      config: runtimeWorkflowStepContributionConfigSchema,
    })
    .strict(),
  runtimeContributionBaseSchema
    .extend({
      type: z.literal("workflow.hook"),
      config: runtimeWorkflowHookContributionConfigSchema,
    })
    .strict(),
  runtimeContributionBaseSchema
    .extend({
      type: z.literal("event.subscription"),
      config: runtimeEventSubscriptionContributionConfigSchema,
    })
    .strict(),
  runtimeContributionBaseSchema
    .extend({
      type: z.literal("capability.endpoint"),
      config: runtimeCapabilityEndpointContributionConfigSchema,
    })
    .strict(),
  runtimeContributionBaseSchema
    .extend({
      type: z.literal("special_step"),
      config: runtimeJsonObjectSchema.optional(),
    })
    .strict(),
]);

const baseMessageSchema = z.object({
  protocolVersion: protocolVersionSchema,
  pluginId: pluginIdSchema,
});

const correlatedMessageSchema = baseMessageSchema.extend({
  correlationId: correlationIdSchema,
});

const peerDescriptorSchema = z
  .object({
    id: peerIdSchema,
    version: z.string().min(1).max(128),
    supportedProtocolVersions: z.array(protocolVersionSchema).min(1),
    capabilities: z
      .array(createIdentifierSchema(operationNamePattern))
      .optional(),
  })
  .strict();

const runtimeDescriptorSchema = peerDescriptorSchema
  .extend({
    mode: pluginRuntimeModeSchema,
  })
  .strict();

const responsePluginDescriptorSchema = z
  .object({
    id: peerIdSchema,
    version: z.string().min(1).max(128),
    capabilities: z
      .array(createIdentifierSchema(operationNamePattern))
      .optional(),
  })
  .strict();

export const pluginHandshakeRequestMessageSchema = correlatedMessageSchema
  .extend({
    type: z.literal("handshake.request"),
    runtime: runtimeDescriptorSchema,
    plugin: peerDescriptorSchema,
  })
  .strict();

export const pluginHandshakeResponseMessageSchema = correlatedMessageSchema
  .extend({
    type: z.literal("handshake.response"),
    accepted: z.boolean(),
    runtimeMode: pluginRuntimeModeSchema,
    agreedProtocolVersion: protocolVersionSchema,
    plugin: responsePluginDescriptorSchema,
  })
  .strict();

export const pluginContributionsDeclareMessageSchema = correlatedMessageSchema
  .extend({
    type: z.literal("contributions.declare"),
    contributions: z.array(pluginRuntimeContributionSchema).min(1),
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

export const pluginInvokeRequestMessageSchema = correlatedMessageSchema
  .extend({
    type: z.literal("invoke.request"),
    contributionId: contributionIdSchema,
    operation: operationNameSchema,
    input: payloadSchema,
    timeoutMs: z.number().int().positive().optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

export const pluginInvokeResponseMessageSchema = correlatedMessageSchema
  .extend({
    type: z.literal("invoke.response"),
    ok: z.boolean(),
    output: payloadSchema.optional(),
  })
  .strict();

export const pluginEventDeliverMessageSchema = correlatedMessageSchema
  .extend({
    type: z.literal("event.deliver"),
    topic: eventIdentifierSchema,
    eventName: createIdentifierSchema(tokenIdentifierPattern),
    payload: payloadSchema,
  })
  .strict();

export const pluginHealthCheckRequestMessageSchema = correlatedMessageSchema
  .extend({
    type: z.literal("health.check.request"),
  })
  .strict();

export const pluginHealthCheckResponseMessageSchema = correlatedMessageSchema
  .extend({
    type: z.literal("health.check.response"),
    healthy: z.boolean(),
    details: metadataSchema.optional(),
  })
  .strict();

export const pluginShutdownMessageSchema = baseMessageSchema
  .extend({
    type: z.literal("shutdown"),
    reason: createIdentifierSchema(operationNamePattern),
    deadlineMs: z.number().int().positive().optional(),
  })
  .strict();

export const pluginErrorMessageSchema = correlatedMessageSchema
  .extend({
    type: z.literal("error"),
    code: errorCodeSchema,
    message: errorMessageSchema,
    retryable: z.boolean(),
    details: metadataSchema.optional(),
  })
  .strict();

export const pluginRuntimeProtocolMessageSchema = z.discriminatedUnion("type", [
  pluginHandshakeRequestMessageSchema,
  pluginHandshakeResponseMessageSchema,
  pluginContributionsDeclareMessageSchema,
  pluginInvokeRequestMessageSchema,
  pluginInvokeResponseMessageSchema,
  pluginEventDeliverMessageSchema,
  pluginHealthCheckRequestMessageSchema,
  pluginHealthCheckResponseMessageSchema,
  pluginShutdownMessageSchema,
  pluginErrorMessageSchema,
]);

export function parsePluginRuntimeProtocolMessage(
  value: unknown,
): PluginRuntimeProtocolMessage {
  return pluginRuntimeProtocolMessageSchema.parse(value);
}
