import { describe, expect, it } from "vitest";
import {
  LEARNING_CANDIDATE_STATUSES,
  archiveLearningCandidateSchema,
  bulkArchiveLearningCandidatesSchema,
  bulkPromoteLearningCandidatesSchema,
  bulkRejectLearningCandidatesSchema,
  learningScopeSchema,
  listLearningCandidatesSchema,
  promoteLearningCandidateSchema,
  rejectLearningCandidateSchema,
} from "./learning-contracts.schema";

describe("learning contract schemas", () => {
  it("accepts opaque non-project learning scopes", () => {
    expect(
      learningScopeSchema.parse({
        scope_type: "workflow_run",
        scope_id: "run-123",
      }),
    ).toEqual({ scope_type: "workflow_run", scope_id: "run-123" });
  });

  it("allows global scope with omitted scope_id", () => {
    expect(learningScopeSchema.parse({ scope_type: "global" })).toEqual({
      scope_type: "global",
    });
  });

  it("accepts global scope with null scope_id", () => {
    expect(
      learningScopeSchema.parse({
        scope_type: "global",
        scope_id: null,
      }),
    ).toEqual({
      scope_type: "global",
      scope_id: null,
    });
  });

  it("requires scope_id for non-global learning scopes", () => {
    expect(() =>
      learningScopeSchema.parse({ scope_type: "workflow_run" }),
    ).toThrow();
  });

  it("defaults candidate list pagination to page 1", () => {
    expect(listLearningCandidatesSchema.parse({})).toMatchObject({
      page: 1,
      limit: 25,
    });
  });

  it("does not expose unknown filters", () => {
    const parsed = listLearningCandidatesSchema.parse({
      status: "pending",
      unsupported_filter: "forbidden",
    });

    expect(parsed).not.toHaveProperty("unsupported_filter");
  });

  it("strips unknown candidate list keys", () => {
    const parsed = listLearningCandidatesSchema.parse({
      status: "pending",
      unknown: "extra",
    });

    expect(parsed).not.toHaveProperty("unknown");
  });

  it("parses a comma-separated candidate status filter into an array", () => {
    expect(
      listLearningCandidatesSchema.parse({ status: "pending,promoted" }).status,
    ).toEqual(["pending", "promoted"]);
  });

  it("parses a single candidate status into a one-element array", () => {
    expect(
      listLearningCandidatesSchema.parse({ status: "pending" }).status,
    ).toEqual(["pending"]);
  });

  it.each(LEARNING_CANDIDATE_STATUSES)(
    "validates allowed learning status %s",
    (status) => {
      expect(listLearningCandidatesSchema.parse({ status }).status).toEqual([
        status,
      ]);
    },
  );

  it("rejects an invalid learning candidate status in the list", () => {
    expect(() =>
      listLearningCandidatesSchema.parse({ status: "invalid" }),
    ).toThrow();
  });

  it("parses an already-array status filter (repeated ?status=a&status=b)", () => {
    expect(
      listLearningCandidatesSchema.parse({ status: ["pending", "promoted"] })
        .status,
    ).toEqual(["pending", "promoted"]);
  });

  it("parses candidate_type as a comma-separated array", () => {
    expect(
      listLearningCandidatesSchema.parse({
        candidate_type: "agent_capture,runtime_learning",
      }).candidate_type,
    ).toEqual(["agent_capture", "runtime_learning"]);
  });

  it("parses an already-array candidate_type filter", () => {
    expect(
      listLearningCandidatesSchema.parse({
        candidate_type: ["agent_capture", "runtime_learning"],
      }).candidate_type,
    ).toEqual(["agent_capture", "runtime_learning"]);
  });

  it("coerces min_score to a number", () => {
    expect(
      listLearningCandidatesSchema.parse({ min_score: "0.5" }).min_score,
    ).toBe(0.5);
  });

  it("coerces created_from/created_to to dates", () => {
    const parsed = listLearningCandidatesSchema.parse({
      created_from: "2026-06-01T00:00:00.000Z",
      created_to: "2026-06-30T00:00:00.000Z",
    });
    expect(parsed.created_from).toBeInstanceOf(Date);
    expect(parsed.created_to).toBeInstanceOf(Date);
  });

  it("accepts search, sortBy and sortDir for candidates", () => {
    expect(
      listLearningCandidatesSchema.parse({
        search: "flaky",
        sortBy: "score",
        sortDir: "asc",
      }),
    ).toMatchObject({ search: "flaky", sortBy: "score", sortDir: "asc" });
  });

  it("accepts a valid promotion trigger body", () => {
    expect(
      promoteLearningCandidateSchema.parse({
        candidate_id: "00000000-0000-4000-8000-000000000001",
        requested_by: "reviewer-1",
      }),
    ).toEqual({
      candidate_id: "00000000-0000-4000-8000-000000000001",
      requested_by: "reviewer-1",
    });
  });

  it("rejects an invalid promotion candidate UUID", () => {
    expect(() =>
      promoteLearningCandidateSchema.parse({ candidate_id: "candidate-1" }),
    ).toThrow();
  });

  it("trims the optional promotion requester", () => {
    expect(
      promoteLearningCandidateSchema.parse({
        candidate_id: "00000000-0000-4000-8000-000000000001",
        requested_by: "  reviewer-1  ",
      }).requested_by,
    ).toBe("reviewer-1");
  });

  it("rejects a blank promotion requester", () => {
    expect(() =>
      promoteLearningCandidateSchema.parse({
        candidate_id: "00000000-0000-4000-8000-000000000001",
        requested_by: "   ",
      }),
    ).toThrow();
  });

  it("strips unknown promotion trigger keys", () => {
    const parsed = promoteLearningCandidateSchema.parse({
      candidate_id: "00000000-0000-4000-8000-000000000001",
      unknown: "extra",
    });

    expect(parsed).not.toHaveProperty("unknown");
  });
});

describe("candidate reject/archive schemas", () => {
  it("requires a reason to reject a candidate", () => {
    expect(() => rejectLearningCandidateSchema.parse({ reason: "" })).toThrow();
  });

  it("accepts an optional rejecting actor", () => {
    expect(
      rejectLearningCandidateSchema.parse({
        reason: "Not useful",
        rejected_by: "reviewer-1",
      }),
    ).toEqual({ reason: "Not useful", rejected_by: "reviewer-1" });
  });

  it("allows archiving without a reason", () => {
    expect(archiveLearningCandidateSchema.parse({})).toEqual({});
  });

  it("accepts an optional archive reason and actor", () => {
    expect(
      archiveLearningCandidateSchema.parse({
        reason: "Superseded",
        archived_by: "reviewer-1",
      }),
    ).toEqual({ reason: "Superseded", archived_by: "reviewer-1" });
  });

  it("requires at least one id to bulk reject candidates", () => {
    expect(() =>
      bulkRejectLearningCandidatesSchema.parse({
        candidate_ids: [],
        reason: "stale",
      }),
    ).toThrow();
  });

  it("requires a reason to bulk reject candidates", () => {
    expect(() =>
      bulkRejectLearningCandidatesSchema.parse({
        candidate_ids: ["00000000-0000-4000-8000-000000000001"],
        reason: "",
      }),
    ).toThrow();
  });

  it("caps bulk candidate ids at 100", () => {
    const ids = Array.from(
      { length: 101 },
      () => "00000000-0000-4000-8000-000000000001",
    );
    expect(() =>
      bulkRejectLearningCandidatesSchema.parse({
        candidate_ids: ids,
        reason: "stale",
      }),
    ).toThrow();
  });

  it("allows bulk archiving candidates without a reason", () => {
    expect(
      bulkArchiveLearningCandidatesSchema.parse({
        candidate_ids: ["00000000-0000-4000-8000-000000000001"],
      }),
    ).toEqual({ candidate_ids: ["00000000-0000-4000-8000-000000000001"] });
  });

  it("accepts a bulk promote request", () => {
    expect(
      bulkPromoteLearningCandidatesSchema.parse({
        candidate_ids: ["00000000-0000-4000-8000-000000000001"],
        requested_by: "reviewer-1",
      }),
    ).toEqual({
      candidate_ids: ["00000000-0000-4000-8000-000000000001"],
      requested_by: "reviewer-1",
    });
  });
});
