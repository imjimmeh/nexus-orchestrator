import { describe, expect, it } from "vitest";
import { toJSONSchema } from "zod";
import {
  SpawnSubagentAsyncSchema,
  WaitForSubagentsSchema,
} from "./subagents.schemas.js";

describe("SpawnSubagentAsyncSchema", () => {
  it("accepts valid async spawn payloads without a tier", () => {
    const input = {
      action: "spawn_subagent_async",
      agent_profile: "senior_dev",
      task_prompt: "Implement the next milestone",
      tools: ["read", "bash"],
      assigned_files: ["apps/api/src/workflow/example.ts"],
      host_mounts: [
        {
          alias: "skills_library",
          subpath: "compose-mounted-skill",
          mode: "ro",
        },
      ],
      inherit_host_mounts: false,
    };

    expect(SpawnSubagentAsyncSchema.parse(input)).toEqual(input);
  });

  it("renders tools and assigned_files as unions in JSON schema", () => {
    const schemaJson = toJSONSchema(SpawnSubagentAsyncSchema);
    const toolsSchema = schemaJson.properties?.tools as Record<string, unknown>;
    const filesSchema = schemaJson.properties?.assigned_files as Record<
      string,
      unknown
    >;

    expect(toolsSchema.anyOf).toBeDefined();
    expect(filesSchema.anyOf).toBeDefined();
  });

  it("rejects model-facing async tier choices", () => {
    expect(() =>
      SpawnSubagentAsyncSchema.parse({
        action: "spawn_subagent_async",
        agent_profile: "senior_dev",
        task_prompt: "Implement the next milestone",
        tools: ["read", "bash"],
        tier: "heavy",
      }),
    ).toThrow();
  });
});

describe("WaitForSubagentsSchema", () => {
  it("accepts native execution id arrays and numeric timeouts", () => {
    const input = {
      action: "wait_for_subagents",
      execution_ids: ["execution-1", "execution-2"],
      timeout_seconds: 300,
    };

    expect(WaitForSubagentsSchema.parse(input)).toEqual(input);
  });

  it("accepts JSON-stringified execution ids at Zod level", () => {
    const result = WaitForSubagentsSchema.parse({
      action: "wait_for_subagents",
      execution_ids: '["execution-1","execution-2"]',
    });
    // String is accepted by the union; normalisation happens before parse.
    expect(result.execution_ids).toBe('["execution-1","execution-2"]');
  });

  it("accepts string timeout values at Zod level", () => {
    const result = WaitForSubagentsSchema.parse({
      action: "wait_for_subagents",
      timeout_seconds: "300",
    });
    expect(result.timeout_seconds).toBe("300");
  });

  it("renders execution_ids as a union in JSON schema", () => {
    const schemaJson = toJSONSchema(WaitForSubagentsSchema);
    const execSchema = schemaJson.properties?.execution_ids as Record<
      string,
      unknown
    >;
    expect(execSchema.anyOf).toBeDefined();
    const types = (execSchema.anyOf as Array<Record<string, unknown>>).map(
      (s) => s.type,
    );
    expect(types).toContain("string");
    expect(types).toContain("array");
  });
});
