import { describe, expect, it } from "vitest";
import {
  parsePluginRuntimeProtocolMessage,
  PLUGIN_RUNTIME_PROTOCOL_METADATA_MAX_BYTES,
  PLUGIN_RUNTIME_PROTOCOL_PAYLOAD_MAX_BYTES,
  pluginRuntimeProtocolMessageSchema,
} from "./plugin-runtime-protocol.schema";
import { PLUGIN_RUNTIME_PROTOCOL_VERSION } from "./plugin-runtime-protocol.types";

const protocolVersion = PLUGIN_RUNTIME_PROTOCOL_VERSION;
const pluginId = "com.acme.workflow-tools";
const correlationId = "runtime-message-1";

const contribution = {
  id: "acme.send_webhook",
  type: "special_step",
  displayName: "Send Webhook",
  description: "Sends a webhook to Acme.",
  entrypoint: "sendWebhook",
  config: {
    inputContract: "WebhookInput",
  },
};

class RuntimeOnlyValue {
  get value(): string {
    return "not-json";
  }
}

describe("pluginRuntimeProtocolMessageSchema", () => {
  it("parses handshake request messages", () => {
    const message = parsePluginRuntimeProtocolMessage({
      protocolVersion,
      type: "handshake.request",
      pluginId,
      correlationId,
      runtime: {
        id: "nexus-kernel",
        version: "0.1.0",
        mode: "worker_process",
        supportedProtocolVersions: [protocolVersion],
        capabilities: ["invoke", "event.deliver"],
      },
      plugin: {
        id: pluginId,
        version: "1.2.3",
        supportedProtocolVersions: [protocolVersion],
        capabilities: ["special_step"],
      },
    });

    expect(message.type).toBe("handshake.request");
    expect(message.correlationId).toBe(correlationId);
  });

  it("parses handshake response messages", () => {
    const message = parsePluginRuntimeProtocolMessage({
      protocolVersion,
      type: "handshake.response",
      pluginId,
      correlationId,
      accepted: true,
      runtimeMode: "worker_process",
      agreedProtocolVersion: protocolVersion,
      plugin: {
        id: pluginId,
        version: "1.2.3",
        capabilities: ["special_step"],
      },
    });

    expect(message.type).toBe("handshake.response");
    expect(message.accepted).toBe(true);
  });

  it("parses contribution declaration messages", () => {
    const message = parsePluginRuntimeProtocolMessage({
      protocolVersion,
      type: "contributions.declare",
      pluginId,
      correlationId,
      contributions: [contribution],
    });

    expect(message.type).toBe("contributions.declare");
    expect(message.contributions).toEqual([contribution]);
  });

  it("parses typed contribution declaration messages and applies config defaults", () => {
    const message = parsePluginRuntimeProtocolMessage({
      protocolVersion,
      type: "contributions.declare",
      pluginId,
      correlationId,
      contributions: [
        {
          id: "acme.send_message",
          type: "tool",
          displayName: "Send Message",
          config: {
            inputSchema: {
              type: "object",
            },
          },
        },
        {
          id: "acme.workflow.notify",
          type: "workflow.step",
          displayName: "Notify Acme",
          config: {
            stepType: "acme.notify",
            inputContract: "NotifyInput",
          },
        },
        {
          id: "acme.workflow.hook",
          type: "workflow.hook",
          displayName: "Acme Workflow Hook",
          config: {
            events: ["workflow.run.started"],
          },
        },
        {
          id: "acme.events.audit",
          type: "event.subscription",
          displayName: "Acme Audit Subscription",
          config: {
            topics: ["workflow.run.completed.v1"],
          },
        },
        {
          id: "acme.capability.audit",
          type: "capability.endpoint",
          displayName: "Audit Endpoint",
          config: {
            inputSchema: {
              type: "object",
            },
            visibility: ["workflow"],
          },
        },
      ],
    });

    if (message.type !== "contributions.declare") {
      throw new Error("Expected contributions declaration message");
    }

    expect(message.contributions[0]?.config?.operation).toBe("execute");
    expect(message.contributions[1]?.config?.operation).toBe("execute");
    expect(message.contributions[2]?.config?.operation).toBe("handle");
    expect(message.contributions[2]?.config?.blocking).toBe(false);
    expect(message.contributions[3]?.config?.operation).toBe("handle");
    expect(message.contributions[4]?.config?.operation).toBe("invoke");
    expect(message.contributions[4]?.config?.retryable).toBe(false);
  });

  it("rejects known runtime contribution declarations missing required config", () => {
    const result = pluginRuntimeProtocolMessageSchema.safeParse({
      protocolVersion,
      type: "contributions.declare",
      pluginId,
      correlationId,
      contributions: [
        {
          id: "acme.send_message",
          type: "tool",
          displayName: "Send Message",
          config: {},
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some(
        (issue) =>
          issue.path.join(".") === "contributions.0.config.inputSchema",
      ),
    ).toBe(true);
  });

  it("rejects unknown config fields in known runtime contribution declarations", () => {
    const result = pluginRuntimeProtocolMessageSchema.safeParse({
      protocolVersion,
      type: "contributions.declare",
      pluginId,
      correlationId,
      contributions: [
        {
          id: "acme.workflow.notify",
          type: "workflow.step",
          displayName: "Notify Acme",
          config: {
            stepType: "acme.notify",
            inputContract: "NotifyInput",
            unexpected: true,
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("config")),
    ).toBe(true);
  });

  it("parses invocation request messages", () => {
    const message = parsePluginRuntimeProtocolMessage({
      protocolVersion,
      type: "invoke.request",
      pluginId,
      correlationId,
      contributionId: contribution.id,
      operation: "execute",
      input: {
        url: "https://example.test/webhook",
      },
      timeoutMs: 30_000,
      metadata: {
        workflowRunId: "run-123",
      },
    });

    expect(message.type).toBe("invoke.request");
    expect(message.contributionId).toBe(contribution.id);
  });

  it("parses invocation response messages", () => {
    const message = parsePluginRuntimeProtocolMessage({
      protocolVersion,
      type: "invoke.response",
      pluginId,
      correlationId,
      ok: true,
      output: {
        status: "sent",
      },
    });

    expect(message.type).toBe("invoke.response");
    expect(message.ok).toBe(true);
  });

  it("parses event delivery messages", () => {
    const message = parsePluginRuntimeProtocolMessage({
      protocolVersion,
      type: "event.deliver",
      pluginId,
      correlationId,
      topic: "workflow.run.completed",
      eventName: "WorkflowRunCompleted",
      payload: {
        workflowRunId: "run-123",
      },
    });

    expect(message.type).toBe("event.deliver");
    expect(message.eventName).toBe("WorkflowRunCompleted");
  });

  it("parses health check request and response messages strictly", () => {
    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "health.check.request",
        pluginId,
        correlationId,
      }).success,
    ).toBe(true);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "health.check.response",
        pluginId,
        correlationId,
        healthy: true,
        details: {
          uptimeMs: 1200,
        },
        extraField: "rejected",
      }).success,
    ).toBe(false);
  });

  it("parses shutdown messages", () => {
    const message = parsePluginRuntimeProtocolMessage({
      protocolVersion,
      type: "shutdown",
      pluginId,
      reason: "runtime_restarting",
      deadlineMs: 5_000,
    });

    expect(message.type).toBe("shutdown");
    expect(message.reason).toBe("runtime_restarting");
  });

  it("parses error messages", () => {
    const message = parsePluginRuntimeProtocolMessage({
      protocolVersion,
      type: "error",
      pluginId,
      correlationId,
      code: "PLUGIN_TIMEOUT",
      message: "The plugin invocation timed out.",
      retryable: true,
      details: {
        timeoutMs: 30_000,
      },
    });

    expect(message.type).toBe("error");
    expect(message.retryable).toBe(true);
  });

  it("rejects unsupported protocol versions", () => {
    const result = pluginRuntimeProtocolMessageSchema.safeParse({
      protocolVersion: "1900-01-01",
      type: "health.check.request",
      pluginId,
      correlationId,
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed message types", () => {
    const result = pluginRuntimeProtocolMessageSchema.safeParse({
      protocolVersion,
      type: "handshake",
      pluginId,
      correlationId,
    });

    expect(result.success).toBe(false);
  });

  it("rejects request and response messages without correlation ids", () => {
    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "invoke.request",
        pluginId,
        contributionId: contribution.id,
        operation: "execute",
        input: {},
      }).success,
    ).toBe(false);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "invoke.response",
        pluginId,
        ok: true,
        output: {},
      }).success,
    ).toBe(false);
  });

  it("rejects oversized payload metadata", () => {
    const result = pluginRuntimeProtocolMessageSchema.safeParse({
      protocolVersion,
      type: "invoke.request",
      pluginId,
      correlationId,
      contributionId: contribution.id,
      operation: "execute",
      input: {},
      metadata: {
        trace: "x".repeat(PLUGIN_RUNTIME_PROTOCOL_METADATA_MAX_BYTES + 1),
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects oversized plugin-controlled payloads", () => {
    const result = pluginRuntimeProtocolMessageSchema.safeParse({
      protocolVersion,
      type: "event.deliver",
      pluginId,
      correlationId,
      topic: "workflow.run.completed",
      eventName: "WorkflowRunCompleted",
      payload: {
        body: "x".repeat(PLUGIN_RUNTIME_PROTOCOL_PAYLOAD_MAX_BYTES + 1),
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-json plugin-controlled payloads", () => {
    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "invoke.request",
        pluginId,
        correlationId,
        contributionId: contribution.id,
        operation: "execute",
        input: {
          handler: () => "not json",
        },
      }).success,
    ).toBe(false);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "invoke.response",
        pluginId,
        correlationId,
        ok: true,
        output: BigInt(1),
      }).success,
    ).toBe(false);
  });

  it("rejects payloads deeper than the protocol limit", () => {
    const result = pluginRuntimeProtocolMessageSchema.safeParse({
      protocolVersion,
      type: "invoke.request",
      pluginId,
      correlationId,
      contributionId: contribution.id,
      operation: "execute",
      input: {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: "too deep",
                },
              },
            },
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("measures metadata size in utf-8 bytes", () => {
    const result = pluginRuntimeProtocolMessageSchema.safeParse({
      protocolVersion,
      type: "invoke.request",
      pluginId,
      correlationId,
      contributionId: contribution.id,
      operation: "execute",
      input: {},
      metadata: {
        trace: "€".repeat(PLUGIN_RUNTIME_PROTOCOL_METADATA_MAX_BYTES / 2),
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects circular and bigint metadata without throwing", () => {
    const circularMetadata: Record<string, unknown> = {};
    circularMetadata.self = circularMetadata;
    let result: ReturnType<typeof pluginRuntimeProtocolMessageSchema.safeParse>;

    expect(
      () =>
        (result = pluginRuntimeProtocolMessageSchema.safeParse({
          protocolVersion,
          type: "invoke.request",
          pluginId,
          correlationId,
          contributionId: contribution.id,
          operation: "execute",
          input: {},
          metadata: circularMetadata,
        })),
    ).not.toThrow();
    expect(result!.success).toBe(false);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "invoke.request",
        pluginId,
        correlationId,
        contributionId: contribution.id,
        operation: "execute",
        input: {},
        metadata: {
          attempt: BigInt(1),
        },
      }).success,
    ).toBe(false);
  });

  it("rejects non-plain object instances in runtime JSON fields", () => {
    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "invoke.request",
        pluginId,
        correlationId,
        contributionId: contribution.id,
        operation: "execute",
        input: new Date("2026-05-17T00:00:00.000Z"),
      }).success,
    ).toBe(false);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "invoke.response",
        pluginId,
        correlationId,
        ok: true,
        output: new Map([["status", "sent"]]),
      }).success,
    ).toBe(false);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "event.deliver",
        pluginId,
        correlationId,
        topic: "workflow.run.completed",
        eventName: "WorkflowRunCompleted",
        payload: new Set(["run-123"]),
      }).success,
    ).toBe(false);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "invoke.request",
        pluginId,
        correlationId,
        contributionId: contribution.id,
        operation: "execute",
        input: {},
        metadata: {
          runtimeValue: new RuntimeOnlyValue(),
        },
      }).success,
    ).toBe(false);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "error",
        pluginId,
        correlationId,
        code: "PLUGIN_TIMEOUT",
        message: "The plugin invocation timed out.",
        retryable: true,
        details: {
          cause: /timeout/u,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects sparse arrays in runtime JSON fields", () => {
    const sparseArray = ["first"];
    sparseArray[2] = "third";

    const result = pluginRuntimeProtocolMessageSchema.safeParse({
      protocolVersion,
      type: "invoke.request",
      pluginId,
      correlationId,
      contributionId: contribution.id,
      operation: "execute",
      input: sparseArray,
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate contribution ids in declaration messages", () => {
    const result = pluginRuntimeProtocolMessageSchema.safeParse({
      protocolVersion,
      type: "contributions.declare",
      pluginId,
      correlationId,
      contributions: [contribution, { ...contribution }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects oversized, whitespace-padded, and malformed protocol identifiers", () => {
    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "health.check.request",
        pluginId: `com.acme.${"x".repeat(256)}`,
        correlationId,
      }).success,
    ).toBe(false);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "health.check.request",
        pluginId: ` ${pluginId}`,
        correlationId,
      }).success,
    ).toBe(false);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "invoke.request",
        pluginId,
        correlationId: "bad correlation id with spaces",
        contributionId: contribution.id,
        operation: "execute",
        input: {},
      }).success,
    ).toBe(false);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "invoke.request",
        pluginId,
        correlationId,
        contributionId: "bad contribution id with spaces",
        operation: " execute",
        input: {},
      }).success,
    ).toBe(false);

    expect(
      pluginRuntimeProtocolMessageSchema.safeParse({
        protocolVersion,
        type: "error",
        pluginId,
        correlationId,
        code: "plugin timeout",
        message: "x".repeat(2049),
        retryable: false,
      }).success,
    ).toBe(false);
  });

  it("rejects invalid contribution declaration shapes", () => {
    const result = pluginRuntimeProtocolMessageSchema.safeParse({
      protocolVersion,
      type: "contributions.declare",
      pluginId,
      correlationId,
      contributions: [
        {
          id: contribution.id,
          type: "special_step",
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
