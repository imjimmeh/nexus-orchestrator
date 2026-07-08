import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LearningCandidate } from "@/lib/api/projects.types";
import { LearningTabCandidatesCard } from "./LearningTabCandidatesCard";

const apiMock = vi.hoisted(() => ({
  getLearningCandidates: vi.fn(),
}));
vi.mock("@/lib/api/client", () => ({ api: apiMock }));

const mutationsMock = vi.hoisted(() => ({
  rejectMutateAsync: vi.fn(),
  archiveMutateAsync: vi.fn(),
  promoteMutateAsync: vi.fn(),
  bulkRejectMutateAsync: vi.fn(),
  bulkArchiveMutateAsync: vi.fn(),
  bulkPromoteMutateAsync: vi.fn(),
}));
vi.mock("@/hooks/useLearningMemory", () => ({
  useRejectLearningCandidate: () => ({
    mutateAsync: mutationsMock.rejectMutateAsync,
    isPending: false,
  }),
  useArchiveLearningCandidate: () => ({
    mutateAsync: mutationsMock.archiveMutateAsync,
    isPending: false,
  }),
  usePromoteLearningCandidate: () => ({
    mutateAsync: mutationsMock.promoteMutateAsync,
    isPending: false,
  }),
  useBulkRejectLearningCandidates: () => ({
    mutateAsync: mutationsMock.bulkRejectMutateAsync,
    isPending: false,
  }),
  useBulkArchiveLearningCandidates: () => ({
    mutateAsync: mutationsMock.bulkArchiveMutateAsync,
    isPending: false,
  }),
  useBulkPromoteLearningCandidates: () => ({
    mutateAsync: mutationsMock.bulkPromoteMutateAsync,
    isPending: false,
  }),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toastMock }));

function makeCandidate(
  overrides: Partial<LearningCandidate> & { id: string; title: string },
): LearningCandidate {
  return {
    scope_type: "global",
    scope_id: null,
    candidate_type: "retrospective",
    summary: "A test summary",
    fingerprint: `fp-${overrides.id}`,
    score: 0.5,
    confidence: 0.5,
    recurrence_count: 1,
    signals_json: {},
    status: "pending",
    promoted_at: null,
    human_approved_at: null,
    first_seen_at: "2026-06-01T00:00:00.000Z",
    last_seen_at: "2026-06-01T00:00:00.000Z",
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    archived_at: null,
    archived_by: null,
    archive_reason: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/project-1/board"]}>
        <Routes>
          <Route
            path="/projects/:projectId/board"
            element={<LearningTabCandidatesCard />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LearningTabCandidatesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    apiMock.getLearningCandidates.mockResolvedValue({
      data: [makeCandidate({ id: "c1", title: "Avoid N+1 query pattern" })],
      meta: {
        pagination: { total: 1, page: 1, limit: 25, totalPages: 1 },
        suppressedCount: 0,
      },
    });
  });

  it("fetches candidates itself and renders the result", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });
    expect(apiMock.getLearningCandidates).toHaveBeenCalled();
  });

  it("records a per-project last-viewed timestamp using the real route project id", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    const stored = window.localStorage.getItem(
      "nexus_learning_tab_last_viewed_project-1",
    );
    expect(stored).not.toBeNull();
    expect(new Date(stored as string).getTime()).not.toBeNaN();
  });

  it("does not badge a candidate as New once the project has already been visited", async () => {
    window.localStorage.setItem(
      "nexus_learning_tab_last_viewed_project-1",
      "2026-06-15T00:00:00.000Z",
    );
    apiMock.getLearningCandidates.mockResolvedValue({
      data: [
        makeCandidate({
          id: "c1",
          title: "Avoid N+1 query pattern",
          created_at: "2026-06-01T00:00:00.000Z",
        }),
      ],
      meta: {
        pagination: { total: 1, page: 1, limit: 25, totalPages: 1 },
        suppressedCount: 0,
      },
    });

    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });
    expect(screen.queryByText("New")).toBeNull();
  });

  it("defaults the status filter to pending and promoted", async () => {
    renderCard();

    await waitFor(() => {
      expect(apiMock.getLearningCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ status: ["pending", "promoted"] }),
      );
    });
  });

  it("rejects a candidate via the inline action, requiring a reason", async () => {
    mutationsMock.rejectMutateAsync.mockResolvedValue({ id: "c1" });
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Reject candidate c1" }),
    );
    fireEvent.change(screen.getByLabelText("Rejection reason"), {
      target: { value: "Not useful" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));

    await waitFor(() => {
      expect(mutationsMock.rejectMutateAsync).toHaveBeenCalledWith({
        candidateId: "c1",
        reason: "Not useful",
        rejectedBy: undefined,
      });
    });
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Candidate rejected",
        expect.any(String),
      );
    });
  });

  it("shows an error toast with the API error message when rejecting a candidate fails", async () => {
    mutationsMock.rejectMutateAsync.mockRejectedValue(new Error("boom"));
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Reject candidate c1" }),
    );
    fireEvent.change(screen.getByLabelText("Rejection reason"), {
      target: { value: "Not useful" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Failed to reject candidate",
        "boom",
      );
    });
  });

  it("archives a candidate via the inline action and shows a success toast", async () => {
    mutationsMock.archiveMutateAsync.mockResolvedValue({ id: "c1" });
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(mutationsMock.archiveMutateAsync).toHaveBeenCalledWith({
        candidateId: "c1",
      });
    });
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Candidate archived",
        expect.any(String),
      );
    });
  });

  it("promotes a pending candidate via the inline action and shows a success toast", async () => {
    mutationsMock.promoteMutateAsync.mockResolvedValue({
      candidate_id: "c1",
      memory_segment_id: "segment-1",
      status: "promoted",
      policy_decision: "auto",
    });
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Promote" }));

    await waitFor(() => {
      expect(mutationsMock.promoteMutateAsync).toHaveBeenCalledWith({
        candidateId: "c1",
      });
    });
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Candidate promoted",
        "Memory segment segment-1 was created.",
      );
    });
  });

  it("does not show a Promote action for a non-pending candidate", async () => {
    apiMock.getLearningCandidates.mockResolvedValue({
      data: [
        makeCandidate({
          id: "c1",
          title: "Avoid N+1 query pattern",
          status: "promoted",
        }),
      ],
      meta: {
        pagination: { total: 1, page: 1, limit: 25, totalPages: 1 },
        suppressedCount: 0,
      },
    });
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: "Promote" })).toBeNull();
  });

  it("bulk archives selected candidates and shows a success toast", async () => {
    mutationsMock.bulkArchiveMutateAsync.mockResolvedValue([{ id: "c1" }]);
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select row Avoid N+1 query pattern",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive selected" }));

    await waitFor(() => {
      expect(mutationsMock.bulkArchiveMutateAsync).toHaveBeenCalledWith({
        candidateIds: ["c1"],
      });
    });
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Candidates archived",
        expect.any(String),
      );
    });
  });

  it("promotes selected candidates and shows a success toast when all succeed", async () => {
    mutationsMock.bulkPromoteMutateAsync.mockResolvedValue([
      {
        candidateId: "c1",
        result: {
          candidate_id: "c1",
          memory_segment_id: "seg-1",
          status: "promoted",
        },
      },
    ]);
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select row Avoid N+1 query pattern",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Promote selected" }));

    await waitFor(() => {
      expect(mutationsMock.bulkPromoteMutateAsync).toHaveBeenCalledWith({
        candidateIds: ["c1"],
      });
    });
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Candidates promoted",
        "Promoted 1 of 1 candidate(s).",
      );
    });
  });

  it("shows a summary toast reflecting a partially failed bulk promote", async () => {
    apiMock.getLearningCandidates.mockResolvedValue({
      data: [
        makeCandidate({ id: "c1", title: "Avoid N+1 query pattern" }),
        makeCandidate({ id: "c2", title: "Cache invalidation pattern" }),
      ],
      meta: {
        pagination: { total: 2, page: 1, limit: 25, totalPages: 1 },
        suppressedCount: 0,
      },
    });
    mutationsMock.bulkPromoteMutateAsync.mockResolvedValue([
      {
        candidateId: "c1",
        result: {
          candidate_id: "c1",
          memory_segment_id: "seg-1",
          status: "promoted",
        },
      },
      { candidateId: "c2", error: "conflict" },
    ]);
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select row Avoid N+1 query pattern",
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select row Cache invalidation pattern",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Promote selected" }));

    await waitFor(() => {
      expect(mutationsMock.bulkPromoteMutateAsync).toHaveBeenCalledWith({
        candidateIds: ["c1", "c2"],
      });
    });
    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalledWith(
        "Candidates partially promoted",
        "Promoted 1 of 2 candidate(s); 1 failed.",
      );
    });
  });

  it("expands a row to show the candidate timeline", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand row Avoid N+1 query pattern",
      }),
    );

    expect(screen.getByText(/First seen/)).toBeTruthy();
  });

  it("disables bulk reject until a reason is entered, then sends the typed reason", async () => {
    mutationsMock.bulkRejectMutateAsync.mockResolvedValue([{ id: "c1" }]);
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select row Avoid N+1 query pattern",
      }),
    );

    const rejectSelectedButton = screen.getByRole("button", {
      name: "Reject selected",
    });
    expect(rejectSelectedButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Bulk rejection reason"), {
      target: { value: "Duplicate cluster" },
    });

    expect(rejectSelectedButton).not.toBeDisabled();

    fireEvent.click(rejectSelectedButton);

    await waitFor(() => {
      expect(mutationsMock.bulkRejectMutateAsync).toHaveBeenCalledWith({
        candidateIds: ["c1"],
        reason: "Duplicate cluster",
      });
    });
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith(
        "Candidates rejected",
        expect.any(String),
      );
    });
  });

  it("sends multiple selected candidate types as an array to the API", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.click(screen.getByLabelText("Agent capture"));
    fireEvent.click(screen.getByLabelText("Retrospective"));

    await waitFor(() => {
      expect(apiMock.getLearningCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          candidate_type: ["agent_capture", "retrospective"],
        }),
      );
    });
  });

  it("sends the selected score threshold as a numeric min_score", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("≥ 0.7"));

    await waitFor(() => {
      expect(apiMock.getLearningCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ min_score: 0.7 }),
      );
    });
  });
});
