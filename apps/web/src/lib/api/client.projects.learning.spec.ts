import { describe, expect, it, vi } from "vitest";
import { projectLearningApiMethods } from "./client.projects.learning";
import type { ApiClient } from "./client";

function createClient() {
  const get = vi.fn().mockResolvedValue({});
  const post = vi.fn().mockResolvedValue({});
  return { get, post, ctx: { get, post } as unknown as ApiClient };
}

describe("projectLearningApiMethods", () => {
  it("builds a comma-joined status query and the new pagination params for candidates", async () => {
    const { get, ctx } = createClient();

    await projectLearningApiMethods.getLearningCandidates.call(ctx, {
      status: ["pending", "promoted"],
      candidate_type: ["agent_capture"],
      search: "flaky",
      min_score: 0.4,
      page: 2,
      limit: 25,
      sortBy: "score",
      sortDir: "desc",
    });

    expect(get).toHaveBeenCalledWith(
      "/memory/learning/candidates?status=pending%2Cpromoted&candidate_type=agent_capture&search=flaky&min_score=0.4&page=2&limit=25&sortBy=score&sortDir=desc",
    );
  });

  it("omits unset query params for candidates", async () => {
    const { get, ctx } = createClient();

    await projectLearningApiMethods.getLearningCandidates.call(ctx, {});

    expect(get).toHaveBeenCalledWith("/memory/learning/candidates");
  });

  it("rejects a learning candidate", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.rejectLearningCandidate.call(
      ctx,
      "candidate-1",
      { reason: "Not useful" },
    );

    expect(post).toHaveBeenCalledWith(
      "/memory/learning/candidates/candidate-1/reject",
      { reason: "Not useful" },
    );
  });

  it("archives a learning candidate", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.archiveLearningCandidate.call(
      ctx,
      "candidate-1",
      {},
    );

    expect(post).toHaveBeenCalledWith(
      "/memory/learning/candidates/candidate-1/archive",
      {},
    );
  });

  it("bulk rejects learning candidates", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.bulkRejectLearningCandidates.call(ctx, {
      candidate_ids: ["c1"],
      reason: "stale batch",
    });

    expect(post).toHaveBeenCalledWith(
      "/memory/learning/candidates/bulk-reject",
      { candidate_ids: ["c1"], reason: "stale batch" },
    );
  });

  it("bulk archives learning candidates", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.bulkArchiveLearningCandidates.call(ctx, {
      candidate_ids: ["c1"],
    });

    expect(post).toHaveBeenCalledWith(
      "/memory/learning/candidates/bulk-archive",
      { candidate_ids: ["c1"] },
    );
  });

  it("bulk promotes learning candidates", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.bulkPromoteLearningCandidates.call(ctx, {
      candidate_ids: ["c1"],
    });

    expect(post).toHaveBeenCalledWith(
      "/memory/learning/candidates/bulk-promote",
      { candidate_ids: ["c1"] },
    );
  });
});
