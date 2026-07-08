import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulesTab } from "./SchedulesTab";

const scheduledHooksMock = vi.hoisted(() => ({
  useScheduledJobs: vi.fn(),
  useScheduledJobRuns: vi.fn(),
  useCreateScheduledJob: vi.fn(),
  useUpdateScheduledJob: vi.fn(),
  usePauseScheduledJob: vi.fn(),
  useResumeScheduledJob: vi.fn(),
  useRunScheduledJobNow: vi.fn(),
  useDeleteScheduledJob: vi.fn(),
}));

const workflowsMock = vi.hoisted(() => ({
  useWorkflows: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/hooks/useScheduledJobs", () => scheduledHooksMock);
vi.mock("@/hooks/useWorkflows", () => workflowsMock);
vi.mock("@/hooks/useToast", () => ({
  useToast: () => toastMock,
}));
vi.mock("./SchedulesTabAutomationHooksCard", () => ({
  SchedulesTabAutomationHooksCard: () => null,
}));
vi.mock("./SchedulesTabHeartbeatCard", () => ({
  SchedulesTabHeartbeatCard: () => null,
}));
vi.mock("./SchedulesTabStandingOrdersCard", () => ({
  SchedulesTabStandingOrdersCard: () => null,
}));

describe("SchedulesTab", () => {
  const createMutateAsync = vi.fn();
  const updateMutateAsync = vi.fn();
  const pauseMutateAsync = vi.fn();
  const resumeMutateAsync = vi.fn();
  const runNowMutateAsync = vi.fn();
  const deleteMutateAsync = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    workflowsMock.useWorkflows.mockReturnValue({
      data: [
        {
          id: "workflow-1",
          name: "Nightly workflow",
          is_active: true,
        },
      ],
    });

    scheduledHooksMock.useScheduledJobs.mockReturnValue({
      data: { items: [], total: 0, limit: 200, offset: 0 },
      isLoading: false,
    });
    scheduledHooksMock.useScheduledJobRuns.mockReturnValue({
      data: { items: [], total: 0, limit: 25, offset: 0 },
      isLoading: false,
    });

    scheduledHooksMock.useCreateScheduledJob.mockReturnValue({
      mutateAsync: createMutateAsync,
      isPending: false,
    });
    scheduledHooksMock.useUpdateScheduledJob.mockReturnValue({
      mutateAsync: updateMutateAsync,
      isPending: false,
    });
    scheduledHooksMock.usePauseScheduledJob.mockReturnValue({
      mutateAsync: pauseMutateAsync,
      isPending: false,
    });
    scheduledHooksMock.useResumeScheduledJob.mockReturnValue({
      mutateAsync: resumeMutateAsync,
      isPending: false,
    });
    scheduledHooksMock.useRunScheduledJobNow.mockReturnValue({
      mutateAsync: runNowMutateAsync,
      isPending: false,
    });
    scheduledHooksMock.useDeleteScheduledJob.mockReturnValue({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    });
  });

  it("submits a new schedule with parsed payload JSON", async () => {
    render(<SchedulesTab projectId="project-1" />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Hourly Test Run" },
    });

    fireEvent.change(screen.getByLabelText("Schedule Type"), {
      target: { value: "interval" },
    });

    fireEvent.change(screen.getByLabelText("Expression"), {
      target: { value: "120" },
    });

    fireEvent.change(screen.getByLabelText("Payload JSON (optional)"), {
      target: { value: '{"source":"unit-test"}' },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Schedule" }));

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Hourly Test Run",
          schedule_type: "interval",
          schedule_expression: "120",
          workflow_id: "workflow-1",
          payload_json: { source: "unit-test" },
        }),
      );
    });
  });

  it("loads schedule into editor when edit is clicked", async () => {
    scheduledHooksMock.useScheduledJobs.mockReturnValue({
      data: {
        items: [
          {
            id: "job-1",
            scopeId: "project-1",
            name: "Nightly Build",
            status: "active",
            schedule_type: "cron",
            schedule_expression: "0 * * * *",
            timezone: "UTC",
            next_run_at: "2026-04-13T00:00:00.000Z",
            execution_target_type: "workflow",
            execution_target_ref: "workflow-1",
            payload_json: { channel: "nightly" },
            created_by: null,
            updated_by: null,
            paused_at: null,
            created_at: "2026-04-12T00:00:00.000Z",
            updated_at: "2026-04-12T00:00:00.000Z",
            last_run: null,
          },
        ],
        total: 1,
        limit: 200,
        offset: 0,
      },
      isLoading: false,
    });

    render(<SchedulesTab projectId="project-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByDisplayValue("Nightly Build")).toBeTruthy();
    expect(screen.getByDisplayValue("0 * * * *")).toBeTruthy();
    expect(screen.getByDisplayValue("UTC")).toBeTruthy();
  });
});
