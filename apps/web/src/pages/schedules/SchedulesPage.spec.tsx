import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SchedulesPage } from "./SchedulesPage";

const hooksMock = vi.hoisted(() => ({
  useCreateScheduledJob: vi.fn(),
  useScheduledJobs: vi.fn(),
  usePauseScheduledJob: vi.fn(),
  useResumeScheduledJob: vi.fn(),
  useRunScheduledJobNow: vi.fn(),
  useDeleteScheduledJob: vi.fn(),
}));

const projectsMock = vi.hoisted(() => ({
  useProjectList: vi.fn(),
}));

const workflowsMock = vi.hoisted(() => ({
  useWorkflows: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/hooks/useScheduledJobs", () => hooksMock);
vi.mock("@/hooks/useProjects", () => projectsMock);
vi.mock("@/hooks/useWorkflows", () => workflowsMock);
vi.mock("@/hooks/useToast", () => ({ useToast: () => toastMock }));

describe("SchedulesPage", () => {
  const createScheduledJob = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    projectsMock.useProjectList.mockReturnValue({
      data: [{ id: "project-1", name: "Apollo" }],
    });

    workflowsMock.useWorkflows.mockReturnValue({
      data: [{ id: "workflow-1", name: "Global Sweep", is_active: true }],
    });

    hooksMock.useScheduledJobs.mockReturnValue({
      data: {
        items: [
          {
            id: "job-1",
            schedule_scope: "global",
            scopeId: null,
            name: "Global Status Sweep",
            status: "active",
            schedule_type: "cron",
            schedule_expression: "*/5 * * * *",
            timezone: "UTC",
            next_run_at: "2026-04-16T12:00:00.000Z",
            execution_target_type: "workflow",
            execution_target_ref: "workflow-1",
            payload_json: {},
            created_by: null,
            updated_by: null,
            paused_at: null,
            created_at: "2026-04-16T11:00:00.000Z",
            updated_at: "2026-04-16T11:00:00.000Z",
            last_run: null,
          },
        ],
        total: 1,
        limit: 200,
        offset: 0,
      },
      isLoading: false,
    });

    hooksMock.usePauseScheduledJob.mockReturnValue({ mutateAsync: vi.fn() });
    hooksMock.useResumeScheduledJob.mockReturnValue({ mutateAsync: vi.fn() });
    hooksMock.useRunScheduledJobNow.mockReturnValue({ mutateAsync: vi.fn() });
    hooksMock.useDeleteScheduledJob.mockReturnValue({ mutateAsync: vi.fn() });
    hooksMock.useCreateScheduledJob.mockReturnValue({
      mutateAsync: createScheduledJob,
      isPending: false,
    });
  });

  it("renders global schedule entries with scope badge", () => {
    render(
      <MemoryRouter>
        <SchedulesPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Global Status Sweep")).toBeTruthy();
    expect(screen.getByText("global")).toBeTruthy();
    expect(screen.getByText("Project: Global")).toBeTruthy();
  });

  it("applies scope filter through scheduled jobs hook arguments", () => {
    render(
      <MemoryRouter>
        <SchedulesPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Scope"), {
      target: { value: "scope" },
    });

    const lastCall = hooksMock.useScheduledJobs.mock.calls.at(-1)?.[0] as {
      scope?: string;
    };

    expect(lastCall.scope).toBe("scope");
  });

  it("creates a global schedule from the page editor", async () => {
    const user = userEvent.setup();
    createScheduledJob.mockResolvedValue({ id: "job-2" });

    render(
      <MemoryRouter>
        <SchedulesPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Name"), "Morning Sweep");
    await user.click(screen.getByRole("button", { name: "Create Schedule" }));

    await waitFor(() => {
      expect(createScheduledJob).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule_scope: "global",
          name: "Morning Sweep",
          workflow_id: "workflow-1",
        }),
      );
    });
  });
});
