import { describe, expect, it } from "vitest";
import {
  parsePluginManifest,
  pluginManifestSchema,
} from "./plugin-manifest.schema";

const validManifest = {
  id: "com.acme.workflow-tools",
  name: "Acme Workflow Tools",
  version: "1.2.3",
  description: "Adds Acme workflow capabilities.",
  author: "Acme Inc.",
  packageName: "@acme/workflow-tools",
  packageVersion: "1.2.3",
  checksum:
    "sha256:8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
  signature: "acme-signature",
  nexusCompatibility: {
    pluginApiVersion: "1.0.0",
    minVersion: "0.1.0",
  },
  entrypoints: {
    main: "./dist/index.js",
    worker: "./dist/worker.js",
  },
  isolationModes: ["worker_process", "container"],
  permissions: [
    { kind: "network", hosts: ["api.acme.test"] },
    { kind: "filesystem", access: "read", paths: ["./config"] },
    { kind: "environment", variables: ["ACME_API_URL"] },
    { kind: "secrets", names: ["acme-api-key"] },
  ],
  contributions: [
    {
      id: "acme.send_webhook",
      type: "tool",
      displayName: "Send Webhook",
      description: "Sends a webhook to Acme.",
      entrypoint: "sendWebhook",
      config: {
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string" },
          },
          required: ["url"],
        },
      },
    },
  ],
};

describe("pluginManifestSchema", () => {
  it("accepts valid plugin manifests", () => {
    const result = pluginManifestSchema.safeParse(validManifest);

    expect(result.success).toBe(true);
    expect(parsePluginManifest(validManifest).id).toBe(
      "com.acme.workflow-tools",
    );
    expect(parsePluginManifest(validManifest).name).toBe("Acme Workflow Tools");
  });

  it("does not require manifest trust level or lifecycle state fields", () => {
    const result = pluginManifestSchema.safeParse({
      id: "com.acme.minimal",
      name: "Minimal Plugin",
      version: "1.0.0",
      nexusCompatibility: {
        pluginApiVersion: "1.0.0",
        minVersion: "0.1.0",
      },
      entrypoints: {
        main: "./dist/index.js",
      },
      isolationModes: ["none"],
      permissions: [],
      contributions: [
        {
          id: "acme.minimal",
          type: "tool",
          displayName: "Minimal Step",
          config: {
            inputSchema: {
              type: "object",
            },
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects manifests with missing required fields", () => {
    const { entrypoints, ...manifestWithoutEntrypoints } = validManifest;

    const result = pluginManifestSchema.safeParse(manifestWithoutEntrypoints);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path[0] === "entrypoints"),
    ).toBe(true);
  });

  it("rejects duplicate contribution ids", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      contributions: [
        validManifest.contributions[0],
        {
          ...validManifest.contributions[0],
          displayName: "Send Webhook Again",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        message: "Duplicate contribution id: acme.send_webhook",
        path: ["contributions", 1, "id"],
      }),
    );
  });

  it("rejects malformed permissions", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      permissions: [{ kind: "network", paths: ["./tmp"] }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects unsupported isolation modes", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      isolationModes: ["worker_process", "browser_iframe"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid known contribution configs with clear nested paths", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      contributions: [
        {
          id: "acme.invalid_tool",
          type: "tool",
          displayName: "Invalid Tool",
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

  it("rejects nested metadata and compatibility fields", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      metadata: {
        name: "Nested Name",
        version: "1.0.0",
      },
      compatibility: {
        pluginApiVersion: "1.0.0",
        nexus: { minVersion: "0.1.0" },
      },
    });

    expect(result.success).toBe(false);
  });
});
