import { describe, it, expect } from "vitest";
import {
  HarnessContributionsSchema,
  HarnessHookAssetSchema,
  HarnessContributionsInputSchema,
} from "./harness-contributions.schema";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "../../interfaces/harness-contributions.types";

describe("HarnessContributionsSchema", () => {
  it("accepts the empty bundle", () => {
    expect(() =>
      HarnessContributionsSchema.parse(EMPTY_HARNESS_CONTRIBUTIONS),
    ).not.toThrow();
  });

  it("accepts a full valid bundle", () => {
    const bundle = {
      hooks: [
        {
          event: "pre_tool_use",
          matcher: "bash",
          command: "echo hi",
          timeoutMs: 5000,
        },
      ],
      extensions: [
        {
          id: "ext-001",
          name: "my-extension",
          runtime: "ts-module",
          entry: "./dist/index.js",
          source: { kind: "authored" },
          checksum: "sha256:abc123",
        },
      ],
      plugins: [],
      settings: {
        env: { FOO: "bar" },
        permissions: { allow: ["Read"] },
        outputStyle: "concise",
      },
    };
    expect(() => HarnessContributionsSchema.parse(bundle)).not.toThrow();
  });

  it("rejects an unknown hook event", () => {
    expect(() =>
      HarnessHookAssetSchema.parse({ event: "nope", command: "x" }),
    ).toThrow();
  });
});

describe("HarnessContributionsInputSchema", () => {
  it("allows any subset (no required arrays)", () => {
    expect(() => HarnessContributionsInputSchema.parse({})).not.toThrow();
    expect(() =>
      HarnessContributionsInputSchema.parse({
        settings: { outputStyle: "concise" },
      }),
    ).not.toThrow();
  });
});
