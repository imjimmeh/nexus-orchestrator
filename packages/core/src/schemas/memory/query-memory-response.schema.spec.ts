import { describe, expect, it } from "vitest";
import {
  queryMemoryResponseLearningProjectionSchema,
  queryMemoryResponseProvenanceSchema,
  queryMemoryResponseSchema,
  queryMemoryResponseSegmentSchema,
} from "./query-memory-response.schema";

const baseSegment = {
  id: "9d8f5d3c-1c45-4f4b-9f8e-9b7e7b6f8c11",
  entity_type: "Project",
  entity_id: "project-1",
  memory_type: "fact" as const,
  content: "Prefer cited repair evidence before mutating workflow behavior.",
  version: 1,
  source: "learning_candidate" as const,
  confidence: 0.85,
  provenance: {
    source_decision_id: "policy:auto-learning-promotion:approved",
    workflow_run_id: "run-123",
    job_id: "job-456",
    agent_profile: "repair-agent",
    requested_by: "workflow_sweep",
    scope_type: "workflow_run",
    scope_id: "run-123",
    learning_candidate_id: "candidate-1",
    promoted_at: "2026-05-16T09:05:00.000Z",
  },
  last_accessed_at: "2026-05-16T10:00:00.000Z",
  created_at: "2026-05-16T09:00:00.000Z",
  metadata_json: {
    source: "learning_candidate",
    learning_candidate_id: "candidate-1",
    promotion_policy: { approved: true, code: "approved" },
  },
  usefulness: 0.85 as number | null,
};

const preferenceSegment = {
  ...baseSegment,
  id: "3a1c5f48-7f2f-4f0c-9d1b-8a4d2b7f6d12",
  source: "user_input" as const,
  confidence: null,
  provenance: null,
  last_accessed_at: null,
  created_at: "2026-04-01T09:00:00.000Z",
  metadata_json: { source: "user_input", tags: ["ui"] },
  content: "User prefers dark mode.",
  usefulness: null,
};

describe("queryMemoryResponseProvenanceSchema", () => {
  it("accepts a full promoted-lesson provenance block", () => {
    expect(
      queryMemoryResponseProvenanceSchema.parse(baseSegment.provenance),
    ).toEqual(baseSegment.provenance);
  });

  it("accepts an empty provenance object", () => {
    expect(queryMemoryResponseProvenanceSchema.parse({})).toEqual({});
  });

  it("preserves additional provenance keys via .loose() (passthrough)", () => {
    const parsed = queryMemoryResponseProvenanceSchema.parse({
      source_decision_id: "policy:auto:approved",
      custom_field: "kept",
    });
    expect(parsed).toEqual({
      source_decision_id: "policy:auto:approved",
      custom_field: "kept",
    });
  });

  it("rejects non-uuid-style identifiers on provenance string fields", () => {
    expect(() =>
      queryMemoryResponseProvenanceSchema.parse({
        workflow_run_id: "  ",
      }),
    ).toThrow();
  });

  it("accepts an ISO-8601 promoted_at timestamp", () => {
    const parsed = queryMemoryResponseProvenanceSchema.parse({
      promoted_at: "2026-05-16T09:05:00.000Z",
    });
    expect(parsed.promoted_at).toBe("2026-05-16T09:05:00.000Z");
  });

  it("accepts a null promoted_at", () => {
    const parsed = queryMemoryResponseProvenanceSchema.parse({
      promoted_at: null,
    });
    expect(parsed.promoted_at).toBeNull();
  });

  it("rejects a non-ISO promoted_at value", () => {
    expect(() =>
      queryMemoryResponseProvenanceSchema.parse({
        promoted_at: "yesterday",
      }),
    ).toThrow();
  });
});

describe("queryMemoryResponseSegmentSchema", () => {
  it("accepts a promoted-learning segment with full provenance and confidence", () => {
    const parsed = queryMemoryResponseSegmentSchema.parse(baseSegment);
    expect(parsed.confidence).toBe(0.85);
    expect(parsed.provenance?.learning_candidate_id).toBe("candidate-1");
  });

  it("accepts a preference segment with null provenance and null confidence", () => {
    const parsed = queryMemoryResponseSegmentSchema.parse(preferenceSegment);
    expect(parsed.confidence).toBeNull();
    expect(parsed.provenance).toBeNull();
    expect(parsed.last_accessed_at).toBeNull();
  });

  it("requires id to be a uuid", () => {
    expect(() =>
      queryMemoryResponseSegmentSchema.parse({
        ...baseSegment,
        id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("rejects confidence outside 0..1", () => {
    expect(() =>
      queryMemoryResponseSegmentSchema.parse({
        ...baseSegment,
        confidence: 1.5,
      }),
    ).toThrow();

    expect(() =>
      queryMemoryResponseSegmentSchema.parse({
        ...baseSegment,
        confidence: -0.1,
      }),
    ).toThrow();
  });

  it("rejects unknown memory_type values", () => {
    expect(() =>
      queryMemoryResponseSegmentSchema.parse({
        ...baseSegment,
        memory_type: "rumor",
      }),
    ).toThrow();
  });

  it("rejects non-ISO created_at strings", () => {
    expect(() =>
      queryMemoryResponseSegmentSchema.parse({
        ...baseSegment,
        created_at: "yesterday",
      }),
    ).toThrow();
  });

  it("accepts metadata_json as a free-form record", () => {
    const parsed = queryMemoryResponseSegmentSchema.parse({
      ...baseSegment,
      metadata_json: { tags: ["repair"], deep: { nested: { value: 1 } } },
    });
    expect(parsed.metadata_json).toEqual({
      tags: ["repair"],
      deep: { nested: { value: 1 } },
    });
  });

  it("accepts metadata_json = null", () => {
    expect(
      queryMemoryResponseSegmentSchema.parse({
        ...baseSegment,
        metadata_json: null,
      }).metadata_json,
    ).toBeNull();
  });
});

describe("queryMemoryResponseLearningProjectionSchema", () => {
  it("wraps promoted segments with count and echoed query", () => {
    const parsed = queryMemoryResponseLearningProjectionSchema.parse({
      query: "repair",
      count: 1,
      segments: [baseSegment],
    });
    expect(parsed.count).toBe(1);
    expect(parsed.query).toBe("repair");
    expect(parsed.segments).toHaveLength(1);
  });

  it("rejects negative counts", () => {
    expect(() =>
      queryMemoryResponseLearningProjectionSchema.parse({
        query: "",
        count: -1,
        segments: [],
      }),
    ).toThrow();
  });
});

describe("queryMemoryResponseSchema", () => {
  it("accepts the full handler response with learning block", () => {
    const parsed = queryMemoryResponseSchema.parse({
      entity_type: "Project",
      entity_id: "project-1",
      query: "repair",
      memory_type: "fact",
      count: 1,
      segments: [baseSegment],
      learning: {
        query: "repair",
        count: 1,
        segments: [baseSegment],
      },
    });
    expect(parsed.count).toBe(1);
    expect(parsed.learning?.segments).toHaveLength(1);
  });

  it("accepts a response without the learning block (include_learning omitted)", () => {
    const parsed = queryMemoryResponseSchema.parse({
      entity_type: "Project",
      entity_id: "project-1",
      query: null,
      memory_type: null,
      count: 2,
      segments: [baseSegment, preferenceSegment],
    });
    expect(parsed.learning).toBeUndefined();
    expect(parsed.segments).toHaveLength(2);
  });

  it("treats the learning block as nullable when explicitly null", () => {
    const parsed = queryMemoryResponseSchema.parse({
      entity_type: "Project",
      entity_id: "project-1",
      query: null,
      memory_type: null,
      count: 1,
      segments: [baseSegment],
      learning: null,
    });
    expect(parsed.learning).toBeNull();
  });

  it("rejects a segment with an out-of-range confidence inside the wrapper", () => {
    expect(() =>
      queryMemoryResponseSchema.parse({
        entity_type: "Project",
        entity_id: "project-1",
        query: null,
        memory_type: null,
        count: 1,
        segments: [{ ...baseSegment, confidence: 1.5 }],
      }),
    ).toThrow();
  });
});
