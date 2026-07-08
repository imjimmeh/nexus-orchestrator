import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalsTab } from "./GoalsTab";

const hooksMock = vi.hoisted(() => ({
  useProjectGoals: vi.fn(),
  useCreateProjectGoal: vi.fn(),
  useUpdateProjectGoal: vi.fn(),
  useUpdateProjectGoalStatus: vi.fn(),
  useArchiveProjectGoal: vi.fn(),
  useUnarchiveProjectGoal: vi.fn(),
  useCreateProjectGoalWorklog: vi.fn(),
  useLinkProjectGoalWorkItem: vi.fn(),
  useProjectGoalWorklogs: vi.fn(),
}));

const apiMock = vi.hoisted(() => ({
  getProjectWorkItems: vi.fn(),
}));

vi.mock("@/hooks/useProjectGoals", () => hooksMock);
vi.mock("@/lib/api/client", () => ({ api: apiMock }));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("GoalsTab", () => {
  const createGoalMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });

    hooksMock.useProjectGoals.mockReturnValue({
      isLoading: false,
      data: [
        {
          id: "goal-1",
          projectId: "project-1",
          title: "Ship goals MVP",
          description: "Allow users to manage goals",
          status: "todo",
          moscow: "must",
          priority: "p1",
          sortOrder: 0,
          targetDate: null,
          completedAt: null,
          ownerAgentProfileId: null,
          metadata: null,
          isArchived: false,
          created_at: "2026-04-06T10:00:00.000Z",
          updated_at: "2026-04-06T10:00:00.000Z",
        },
      ],
    });

    hooksMock.useCreateProjectGoal.mockReturnValue({
      mutateAsync: createGoalMock,
    });
    hooksMock.useUpdateProjectGoal.mockReturnValue({ mutateAsync: vi.fn() });
    hooksMock.useUpdateProjectGoalStatus.mockReturnValue({
      mutateAsync: vi.fn(),
    });
    hooksMock.useArchiveProjectGoal.mockReturnValue({ mutateAsync: vi.fn() });
    hooksMock.useUnarchiveProjectGoal.mockReturnValue({ mutateAsync: vi.fn() });
    hooksMock.useCreateProjectGoalWorklog.mockReturnValue({
      mutateAsync: vi.fn(),
    });
    hooksMock.useLinkProjectGoalWorkItem.mockReturnValue({
      mutateAsync: vi.fn(),
    });
    hooksMock.useProjectGoalWorklogs.mockReturnValue({
      isLoading: false,
      data: [],
    });
  });

  it("creates a goal from the goal maintenance form", async () => {
    const Wrapper = createWrapper();
    render(<GoalsTab projectId="project-1" />, { wrapper: Wrapper });

    expect(screen.getByText("Ship goals MVP")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Goal Title"), {
      target: { value: "Add worklog timeline" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Goal" }));

    await waitFor(() => {
      expect(createGoalMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Add worklog timeline",
        }),
      );
    });
  });
});
