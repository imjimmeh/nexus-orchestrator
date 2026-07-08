import { describe, expect, it } from "vitest";
import { specialStepPluginManifestSchema } from "./special-step-plugin.schema";

describe("specialStepPluginManifestSchema", () => {
  it("accepts a valid special-step plugin manifest", () => {
    const result = specialStepPluginManifestSchema.safeParse({
      id: "com.acme.webhooks",
      name: "Acme Webhooks",
      version: "1.0.0",
      entrypoint: "./dist/index.js",
      specialSteps: [
        {
          type: "acme.send_webhook",
          displayName: "Send Webhook",
          inputContract: "inputs.url and inputs.payload are required",
        },
      ],
      permissions: [{ kind: "network", hosts: ["hooks.example.test"] }],
    });

    expect(result.success).toBe(true);
  });

  it("rejects a manifest with duplicate special-step types", () => {
    const result = specialStepPluginManifestSchema.safeParse({
      id: "com.acme.duplicates",
      name: "Duplicate Types",
      version: "1.0.0",
      entrypoint: "./dist/index.js",
      specialSteps: [
        {
          type: "acme.send_webhook",
          displayName: "Send Webhook",
          inputContract: "inputs.url is required",
        },
        {
          type: "acme.send_webhook",
          displayName: "Send Webhook Again",
          inputContract: "inputs.url is required",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a manifest that uses the reserved execution job type", () => {
    const result = specialStepPluginManifestSchema.safeParse({
      id: "com.acme.reserved-type",
      name: "Reserved Type",
      version: "1.0.0",
      entrypoint: "./dist/index.js",
      specialSteps: [
        {
          type: "execution",
          displayName: "Reserved Execution",
          inputContract: "inputs.value is required",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a manifest that uses a deprecated legacy special-step type", () => {
    const result = specialStepPluginManifestSchema.safeParse({
      id: "com.acme.legacy-type",
      name: "Legacy Type",
      version: "1.0.0",
      entrypoint: "./dist/index.js",
      specialSteps: [
        {
          type: "record_metadata",
          displayName: "Reserved Legacy Type",
          inputContract: "inputs.value is required",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects manifests that use current core special-step types", () => {
    const coreSpecialStepTypes = [
      "register_tool",
      "invoke_workflow",
      "run_command",
      "web_automation",
      "emit_event",
      "http_webhook",
      "mcp_tool_call",
      "git_operation",
      "manage_tool_candidate",
    ];

    for (const coreSpecialStepType of coreSpecialStepTypes) {
      const result = specialStepPluginManifestSchema.safeParse({
        id: "com.acme.core-type",
        name: "Core Type",
        version: "1.0.0",
        entrypoint: "./dist/index.js",
        specialSteps: [
          {
            type: coreSpecialStepType,
            displayName: "Reserved Core Type",
            inputContract: "inputs.value is required",
          },
        ],
      });

      expect(result.success).toBe(false);
    }
  });

  it("rejects unknown manifest keys", () => {
    const result = specialStepPluginManifestSchema.safeParse({
      id: "com.acme.unknown-manifest-key",
      name: "Unknown Manifest Key",
      version: "1.0.0",
      entrypoint: "./dist/index.js",
      specialSteps: [
        {
          type: "acme.send_webhook",
          displayName: "Send Webhook",
          inputContract: "inputs.url is required",
        },
      ],
      unexpected: true,
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown special-step manifest keys", () => {
    const result = specialStepPluginManifestSchema.safeParse({
      id: "com.acme.unknown-handler-key",
      name: "Unknown Handler Key",
      version: "1.0.0",
      entrypoint: "./dist/index.js",
      specialSteps: [
        {
          type: "acme.send_webhook",
          displayName: "Send Webhook",
          inputContract: "inputs.url is required",
          unexpected: true,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid permission shapes", () => {
    const result = specialStepPluginManifestSchema.safeParse({
      id: "com.acme.invalid-permission",
      name: "Invalid Permission",
      version: "1.0.0",
      entrypoint: "./dist/index.js",
      specialSteps: [
        {
          type: "acme.send_webhook",
          displayName: "Send Webhook",
          inputContract: "inputs.url is required",
        },
      ],
      permissions: [{ kind: "network", paths: ["./tmp"] }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown permission keys", () => {
    const result = specialStepPluginManifestSchema.safeParse({
      id: "com.acme.unknown-permission-key",
      name: "Unknown Permission Key",
      version: "1.0.0",
      entrypoint: "./dist/index.js",
      specialSteps: [
        {
          type: "acme.send_webhook",
          displayName: "Send Webhook",
          inputContract: "inputs.url is required",
        },
      ],
      permissions: [
        { kind: "network", hosts: ["hooks.example.test"], unexpected: true },
      ],
    });

    expect(result.success).toBe(false);
  });
});
