import { describe, expect, it } from "vitest";
import {
  parsePluginContribution,
  pluginContributionSchema,
  workflowHookEventNames,
} from "./plugin-contribution.schema";
import { pluginManifestSchema } from "./plugin-manifest.schema";

const inputSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
  },
  required: ["message"],
};

const outputSchema = {
  type: "object",
  properties: {
    delivered: { type: "boolean" },
  },
};

const validManifestBase = {
  id: "com.acme.contributions",
  name: "Acme Contributions",
  version: "1.0.0",
  nexusCompatibility: {
    pluginApiVersion: "1.0.0",
    minVersion: "0.1.0",
  },
  entrypoints: {
    main: "./dist/index.js",
  },
  isolationModes: ["worker_process"],
  permissions: [],
};

describe("pluginContributionSchema", () => {
  it("accepts tool contributions and applies the default operation", () => {
    const result = pluginContributionSchema.parse({
      id: "acme.send_message",
      type: "tool",
      displayName: "Send Message",
      description: "Sends a message through Acme.",
      entrypoint: "tools",
      config: {
        inputSchema,
        outputSchema,
        governance: "approval_required",
        tier: "standard",
      },
    });

    if (result.type !== "tool") {
      throw new Error("Expected tool contribution");
    }

    expect(result.config.operation).toBe("execute");
    expect(result.config.inputSchema).toEqual(inputSchema);
    expect(result.config.outputSchema).toEqual(outputSchema);
    expect(parsePluginContribution(result).type).toBe("tool");
  });

  it("accepts workflow step contributions and applies the default operation", () => {
    const result = pluginContributionSchema.parse({
      id: "acme.workflow.notify",
      type: "workflow.step",
      displayName: "Notify Acme",
      config: {
        stepType: "acme.notify",
        inputContract: inputSchema,
        blocking: true,
        timeoutMs: 30_000,
      },
    });

    if (result.type !== "workflow.step") {
      throw new Error("Expected workflow step contribution");
    }

    expect(result.config.operation).toBe("execute");
    expect(result.config.stepType).toBe("acme.notify");
    expect(result.config.inputContract).toEqual(inputSchema);
  });

  it("accepts workflow hook contributions and applies default blocking and operation values", () => {
    const result = pluginContributionSchema.parse({
      id: "acme.workflow.hook",
      type: "workflow.hook",
      displayName: "Acme Workflow Hook",
      config: {
        events: ["workflow.run.started", "workflow.run.completed"],
        filters: {
          workflowId: "daily-sync",
        },
      },
    });

    if (result.type !== "workflow.hook") {
      throw new Error("Expected workflow hook contribution");
    }

    expect(result.config.blocking).toBe(false);
    expect(result.config.operation).toBe("handle");
    expect(result.config.events).toEqual([
      "workflow.run.started",
      "workflow.run.completed",
    ]);
    expect(workflowHookEventNames).toContain("workflow.run.started");
  });

  it("accepts event subscription contributions for future projection work", () => {
    const result = pluginContributionSchema.parse({
      id: "acme.events.audit",
      type: "event.subscription",
      displayName: "Acme Audit Subscription",
      config: {
        topics: [
          "workflow.run.completed.v1",
          "plugin.com.acme.contributions.audit.*",
        ],
        filters: {
          pluginId: "com.acme.contributions",
        },
        deliveryMode: "non_blocking",
        retry: {
          maxAttempts: 4,
          initialDelayMs: 1000,
          backoffMultiplier: 2,
        },
        deadLetter: {
          enabled: true,
          reasonTemplate: "Subscription delivery failed after retries.",
        },
        requiredPermissions: ["internal_capability:plugin.events.receive"],
        operation: "handle_plugin_registry_changed",
      },
    });

    if (result.type !== "event.subscription") {
      throw new Error("Expected event subscription contribution");
    }

    expect(result.type).toBe("event.subscription");
    expect(result.config.operation).toBe("handle_plugin_registry_changed");
  });

  it("rejects operation names that runtime invoke requests cannot accept", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.events.audit",
      type: "event.subscription",
      displayName: "Acme Audit Subscription",
      config: {
        topics: ["workflow.run.completed.v1"],
        operation: "handlePluginRegistryChanged",
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("operation")),
    ).toBe(true);
  });

  it("rejects operation names longer than the runtime protocol identifier limit", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.events.audit",
      type: "event.subscription",
      displayName: "Acme Audit Subscription",
      config: {
        topics: ["workflow.run.completed.v1"],
        operation: `a${"b".repeat(255)}`,
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("operation")),
    ).toBe(true);
  });

  it("rejects unknown config fields for known contribution types", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.send_message",
      type: "tool",
      displayName: "Send Message",
      config: {
        inputSchema,
        unexpected: true,
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("config")),
    ).toBe(true);
  });

  it("rejects invalid workflow hook event names", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.workflow.hook",
      type: "workflow.hook",
      displayName: "Acme Workflow Hook",
      config: {
        events: ["workflow.secret.dumped"],
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("events")),
    ).toBe(true);
  });

  it("rejects tools without an input schema", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.send_message",
      type: "tool",
      displayName: "Send Message",
      config: {},
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("inputSchema")),
    ).toBe(true);
  });

  it("rejects workflow steps without a step type", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.workflow.notify",
      type: "workflow.step",
      displayName: "Notify Acme",
      config: {
        inputContract: "NotifyInput",
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("stepType")),
    ).toBe(true);
  });

  it("rejects unsupported contribution types", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.widget",
      type: "browser.widget",
      displayName: "Acme Widget",
      config: {},
    });

    expect(result.success).toBe(false);
  });

  it("rejects event subscriptions without topics", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.events.audit",
      type: "event.subscription",
      displayName: "Acme Audit Subscription",
      config: {
        filters: {
          pluginId: "com.acme.contributions",
        },
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("topics")),
    ).toBe(true);
  });

  it("rejects event subscription wildcard topics that are not suffix patterns", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.events.audit",
      type: "event.subscription",
      displayName: "Acme Audit Subscription",
      config: {
        topics: ["workflow.*.completed.v1"],
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("topics")),
    ).toBe(true);
  });

  it("rejects event subscriptions with negative retry attempts", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.events.audit",
      type: "event.subscription",
      displayName: "Acme Audit Subscription",
      config: {
        topics: ["workflow.run.completed.v1"],
        retry: {
          maxAttempts: -1,
        },
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("maxAttempts")),
    ).toBe(true);
  });

  it("accepts capability endpoint contributions with strict visibility", () => {
    const result = pluginContributionSchema.parse({
      id: "acme.capability.audit",
      type: "capability.endpoint",
      displayName: "Audit Endpoint",
      config: {
        inputSchema,
        outputSchema,
        requiredPermissions: ["internal_capability:plugin.endpoint.invoke"],
        operation: "invoke_audit_endpoint",
        timeoutMs: 15_000,
        retryable: true,
        visibility: ["workflow", "tool"],
      },
    });

    if (result.type !== "capability.endpoint") {
      throw new Error("Expected capability endpoint contribution");
    }

    expect(result.config.visibility).toEqual(["workflow", "tool"]);
    expect(result.config.retryable).toBe(true);
  });

  it("rejects capability endpoint contributions missing input schema", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.capability.audit",
      type: "capability.endpoint",
      displayName: "Audit Endpoint",
      config: {
        visibility: ["workflow"],
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("inputSchema")),
    ).toBe(true);
  });

  it("rejects capability endpoint contributions with invalid visibility", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.capability.audit",
      type: "capability.endpoint",
      displayName: "Audit Endpoint",
      config: {
        inputSchema,
        visibility: ["admin"],
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("visibility")),
    ).toBe(true);
  });

  it("rejects capability endpoint contributions with invalid timeout", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.capability.audit",
      type: "capability.endpoint",
      displayName: "Audit Endpoint",
      config: {
        inputSchema,
        visibility: ["workflow"],
        timeoutMs: 0,
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("timeoutMs")),
    ).toBe(true);
  });

  it("rejects unknown fields for capability endpoint contributions", () => {
    const result = pluginContributionSchema.safeParse({
      id: "acme.capability.audit",
      type: "capability.endpoint",
      displayName: "Audit Endpoint",
      config: {
        inputSchema,
        visibility: ["workflow"],
        unknownField: true,
      },
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.includes("config")),
    ).toBe(true);
  });
});

describe("pluginManifestSchema contribution integration", () => {
  it("rejects duplicate contribution ids in one manifest", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifestBase,
      contributions: [
        {
          id: "acme.send_message",
          type: "tool",
          displayName: "Send Message",
          config: { inputSchema },
        },
        {
          id: "acme.send_message",
          type: "workflow.step",
          displayName: "Send Message Workflow Step",
          config: {
            stepType: "acme.send_message",
            inputContract: "SendMessageInput",
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        message: "Duplicate contribution id: acme.send_message",
        path: ["contributions", 1, "id"],
      }),
    );
  });

  it("keeps legacy special_step manifest contributions for EPIC-190 compatibility", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifestBase,
      contributions: [
        {
          id: "acme.legacy_special_step",
          type: "special_step",
          displayName: "Legacy Special Step",
          entrypoint: "legacySpecialStep",
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
