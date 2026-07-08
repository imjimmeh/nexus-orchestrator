import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LearningTab } from "./LearningTab";

const learningHooksMock = vi.hoisted(() => ({
  useLearningMemoryStatus: vi.fn(),
  useRunLearningMemorySweep: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/hooks/useLearningMemory", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useLearningMemory")>();
  return { ...actual, ...learningHooksMock };
});
vi.mock("@/hooks/useToast", () => ({ useToast: () => toastMock }));
vi.mock("@/hooks/useMemoryMetrics", () => ({
  useMemoryMetrics: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

const apiMock = vi.hoisted(() => ({
  getLearningCandidates: vi.fn().mockResolvedValue({
    data: [],
    meta: {
      pagination: { total: 0, page: 1, limit: 25, totalPages: 1 },
      suppressedCount: 0,
    },
  }),
}));
vi.mock("@/lib/api/client", () => ({ api: apiMock }));

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LearningTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LearningTab", () => {
  const runSweepMutateAsync = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    learningHooksMock.useLearningMemoryStatus.mockReturnValue({
      data: {
        enabled: true,
        intervalSeconds: 21600,
        promotionThreshold: 0.72,
        proposalThreshold: 0.84,
        candidateTotals: { pending: 2, promoted: 1 },
        proposalTotals: { pending: 1, approved: 0, rejected: 0, failed: 0 },
        lastRun: null,
      },
      isLoading: false,
    });
    learningHooksMock.useRunLearningMemorySweep.mockReturnValue({
      mutateAsync: runSweepMutateAsync,
      isPending: false,
    });
  });

  it("renders the sweep status panel, the candidates card, and the improvements pointer", async () => {
    renderTab();

    expect(screen.getByText("Learning Candidates")).toBeTruthy();
    expect(screen.getByText("Skill Improvement Proposals")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Go to Improvements" }),
    ).toHaveAttribute("href", "/improvements");

    fireEvent.click(screen.getByRole("button", { name: "Run Sweep Now" }));

    await waitFor(() => {
      expect(runSweepMutateAsync).toHaveBeenCalled();
    });
  });
});
