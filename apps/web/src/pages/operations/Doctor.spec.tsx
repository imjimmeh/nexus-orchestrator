import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Doctor } from "./Doctor";

import { LifecycleResumeSummary } from "@/lib/api/doctor.types";

const mutateMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
let doctorHistoryInputJson: Record<string, unknown> = {};
let resumeSummaryData: LifecycleResumeSummary = {
  frozenFound: 3,
  resumed: 2,
  failed: 1,
  lastResumeAt: "2026-04-12T00:00:00.000Z",
};

vi.mock("@/hooks/useOperationsDoctor", () => ({
  useDoctorReport: () => ({
    isLoading: false,
    isError: false,
    data: {
      report: {
        generated_at: "2026-04-12T00:00:00.000Z",
        overall_status: "warn",
        summary: {
          ok: 1,
          warn: 1,
          fail: 0,
          total: 2,
        },
        checks: [
          {
            check_id: "queue_lag_and_dead_letter_detector",
            status: "warn",
            evidence: {
              summary: "Queue backlog warning",
              details: {
                queues: [],
              },
            },
            repair_action_id: "refresh_mcp_plugin_catalogs",
          },
        ],
      },
      summary_markdown: "# Doctor Report",
    },
  }),
  useDoctorRepairHistory: () => ({
    isLoading: false,
    isError: false,
    data: {
      items: [
        {
          id: "history-1",
          action_id: "refresh_mcp_plugin_catalogs",
          status: "succeeded",
          dry_run: true,
          requested_by: "dev@example.com",
          input_json: doctorHistoryInputJson,
          result_json: { message: "Dry run complete" },
          evidence_json: {},
          error_message: null,
          started_at: "2026-04-12T00:00:00.000Z",
          finished_at: "2026-04-12T00:00:01.000Z",
          created_at: "2026-04-12T00:00:00.000Z",
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    },
  }),
  useExecuteDoctorRepair: () => ({
    mutate: mutateMock,
    isPending: false,
  }),
  useLifecycleResumeSummary: () => ({
    isLoading: false,
    isError: false,
    error: null,
    data: resumeSummaryData,
  }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

describe("Doctor page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doctorHistoryInputJson = {};
    resumeSummaryData = {
      frozenFound: 3,
      resumed: 2,
      failed: 1,
      lastResumeAt: "2026-04-12T00:00:00.000Z",
    };
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
  });

  it("renders doctor summary and history", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Doctor />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Doctor Diagnostics")).toBeTruthy();
    expect(screen.getByText("queue_lag_and_dead_letter_detector")).toBeTruthy();
    expect(screen.getByText("refresh_mcp_plugin_catalogs")).toBeTruthy();
  });

  it("renders last-restart resume summary", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Doctor />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Last Restart Resume")).toBeTruthy();
    expect(screen.getByText("2/3 resumed")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
  });

  it("shows the clean-restart message when no executions were frozen", () => {
    resumeSummaryData = {
      frozenFound: 0,
      resumed: 0,
      failed: 0,
      lastResumeAt: "2026-04-12T00:00:00.000Z",
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Doctor />
      </QueryClientProvider>,
    );

    expect(
      screen.getByText("No executions were resumed on the last restart."),
    ).toBeTruthy();
    expect(screen.queryByText("0/0 resumed")).toBeNull();
  });

  it("submits dry-run repair action", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Doctor />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dry Run Repair" }));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action_id: "refresh_mcp_plugin_catalogs",
        dry_run: true,
        confirm: false,
      }),
      expect.any(Object),
    );
  });

  it("renders autonomy context from doctor history input_json", () => {
    doctorHistoryInputJson = {
      action_id: "prune_orphaned_runtime_artifacts",
      dry_run: true,
      requested_by: "workflow_repair_delegation",
      arguments: {
        workflow_run_id: "run-1",
        failed_job_id: "job-1",
        policy_action_id: "doctor.runtime_artifact.refresh_stale_artifacts",
        repair_attempt: 1,
      },
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Doctor />
      </QueryClientProvider>,
    );

    expect(
      screen.getByText(
        "workflow run run-1 · job job-1 · policy doctor.runtime_artifact.refresh_stale_artifacts · attempt 1",
      ),
    ).toBeTruthy();
  });

  it("leaves manual doctor history without autonomy context unchanged", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Doctor />
      </QueryClientProvider>,
    );

    expect(screen.queryByText(/workflow run run-1/)).toBeNull();
    expect(screen.getByText("Dry run complete")).toBeTruthy();
  });
});
