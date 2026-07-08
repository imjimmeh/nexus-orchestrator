import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useArchiveLearningCandidate,
  useBulkArchiveLearningCandidates,
  useBulkPromoteLearningCandidates,
  useBulkRejectLearningCandidates,
  useRejectLearningCandidate,
} from "./useLearningMemory";

vi.mock("@/lib/api/client", () => ({
  api: {
    rejectLearningCandidate: vi.fn().mockResolvedValue({ id: "c1" }),
    archiveLearningCandidate: vi.fn().mockResolvedValue({ id: "c1" }),
    bulkRejectLearningCandidates: vi.fn().mockResolvedValue([{ id: "c1" }]),
    bulkArchiveLearningCandidates: vi.fn().mockResolvedValue([{ id: "c1" }]),
    bulkPromoteLearningCandidates: vi
      .fn()
      .mockResolvedValue([
        { candidateId: "c1", result: { status: "promoted" } },
      ]),
  },
}));

import { api } from "@/lib/api/client";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("learning candidate lifecycle mutation hooks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("useRejectLearningCandidate calls the API with candidateId + body", async () => {
    const { result } = renderHook(() => useRejectLearningCandidate(), {
      wrapper,
    });

    await result.current.mutateAsync({
      candidateId: "c1",
      reason: "Not useful",
      rejectedBy: "reviewer-1",
    });

    expect(api.rejectLearningCandidate).toHaveBeenCalledWith("c1", {
      reason: "Not useful",
      rejected_by: "reviewer-1",
    });
  });

  it("useArchiveLearningCandidate calls the API with candidateId + body", async () => {
    const { result } = renderHook(() => useArchiveLearningCandidate(), {
      wrapper,
    });

    await result.current.mutateAsync({ candidateId: "c1" });

    expect(api.archiveLearningCandidate).toHaveBeenCalledWith("c1", {
      reason: undefined,
      archived_by: undefined,
    });
  });

  it("useBulkRejectLearningCandidates passes candidate_ids/reason through", async () => {
    const { result } = renderHook(() => useBulkRejectLearningCandidates(), {
      wrapper,
    });

    await result.current.mutateAsync({
      candidateIds: ["c1"],
      reason: "stale batch",
    });

    expect(api.bulkRejectLearningCandidates).toHaveBeenCalledWith({
      candidate_ids: ["c1"],
      reason: "stale batch",
      rejected_by: undefined,
    });
  });

  it("useBulkArchiveLearningCandidates passes candidate_ids through", async () => {
    const { result } = renderHook(() => useBulkArchiveLearningCandidates(), {
      wrapper,
    });

    await result.current.mutateAsync({ candidateIds: ["c1"] });

    expect(api.bulkArchiveLearningCandidates).toHaveBeenCalledWith({
      candidate_ids: ["c1"],
      reason: undefined,
      archived_by: undefined,
    });
  });

  it("useBulkPromoteLearningCandidates passes candidate_ids through", async () => {
    const { result } = renderHook(() => useBulkPromoteLearningCandidates(), {
      wrapper,
    });

    const response = await result.current.mutateAsync({ candidateIds: ["c1"] });

    expect(api.bulkPromoteLearningCandidates).toHaveBeenCalledWith({
      candidate_ids: ["c1"],
      requested_by: undefined,
    });
    expect(response).toEqual([
      { candidateId: "c1", result: { status: "promoted" } },
    ]);
  });
});
