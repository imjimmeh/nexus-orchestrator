import { describe, expect, it, vi } from "vitest";

import { buildToolCatalog } from "./build-tool-catalog.js";
import type { CanonicalToolDefinition } from "../engine/session-context.js";

function makeDef(
  over: Partial<CanonicalToolDefinition> = {},
): CanonicalToolDefinition {
  return {
    name: "set_job_output",
    description: "Set the job output contract fields",
    parameters: { type: "object", properties: {} },
    execute: vi.fn().mockResolvedValue({ content: [] }),
    ...over,
  };
}

describe("buildToolCatalog", () => {
  it("returns an empty catalog when there are no raw tools", () => {
    expect(buildToolCatalog([])).toEqual([]);
  });

  it("maps name, description, and parameters from each raw tool", () => {
    const def = makeDef();
    const [spec] = buildToolCatalog([def]);

    expect(spec?.name).toBe("set_job_output");
    expect(spec?.description).toBe("Set the job output contract fields");
    expect(spec?.parameters).toEqual({ type: "object", properties: {} });
    expect(typeof spec?.invoke).toBe("function");
  });

  it("preserves order and maps every raw tool", () => {
    const catalog = buildToolCatalog([
      makeDef({ name: "set_job_output" }),
      makeDef({ name: "query_memory" }),
      makeDef({ name: "read_skill_manifest" }),
    ]);

    expect(catalog.map((spec) => spec.name)).toEqual([
      "set_job_output",
      "query_memory",
      "read_skill_manifest",
    ]);
  });

  it("invoke forwards params to the raw tool's execute and returns its result", async () => {
    const execute = vi.fn().mockResolvedValue({ content: ["ok"], details: 42 });
    const [spec] = buildToolCatalog([makeDef({ execute })]);

    const result = await spec.invoke({ groomed_board_summary: "done" });

    expect(execute).toHaveBeenCalledTimes(1);
    const [callId, params] = execute.mock.calls[0];
    expect(typeof callId).toBe("string");
    expect(callId).not.toHaveLength(0);
    expect(params).toEqual({ groomed_board_summary: "done" });
    expect(result).toEqual({ content: ["ok"], details: 42 });
  });

  it("generates a distinct call id per invocation", async () => {
    const execute = vi.fn().mockResolvedValue({ content: [] });
    const [spec] = buildToolCatalog([makeDef({ execute })]);

    await spec.invoke({});
    await spec.invoke({});

    const firstId = execute.mock.calls[0][0];
    const secondId = execute.mock.calls[1][0];
    expect(firstId).not.toBe(secondId);
  });
});
