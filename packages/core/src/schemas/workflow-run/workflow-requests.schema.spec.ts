import { describe, expect, it } from "vitest";
import {
  lifecycleResultsQuerySchema,
  workflowRunsQuerySchema,
} from "./workflow-requests.schema";

describe("workflowRunsQuerySchema", () => {
  it("accepts sourceType as an optional filter", () => {
    const result = workflowRunsQuerySchema.parse({ sourceType: "repository" });

    expect(result.sourceType).toBe("repository");
  });

  it("accepts comma-separated sourceType values", () => {
    const result = workflowRunsQuerySchema.parse({ sourceType: "seed,user" });

    expect(result.sourceType).toBe("seed,user");
  });
});

describe("lifecycleResultsQuerySchema", () => {
  it("requires a scopeId", () => {
    expect(() => lifecycleResultsQuerySchema.parse({})).toThrow();
  });

  it("accepts optional context, phase, and hook filters", () => {
    const result = lifecycleResultsQuerySchema.parse({
      scopeId: "scope-1",
      contextId: "context-1",
      phase: "review",
      hook: "before_transition",
    });

    expect(result).toEqual({
      scopeId: "scope-1",
      contextId: "context-1",
      phase: "review",
      hook: "before_transition",
    });
  });
});
