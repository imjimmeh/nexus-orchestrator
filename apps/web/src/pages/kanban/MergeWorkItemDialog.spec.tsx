import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkItem } from "@/lib/api/work-items.types";
import { MergeWorkItemDialog } from "./MergeWorkItemDialog";

const GATE_BLOCKED_ERROR = {
  response: {
    status: 409,
    data: {
      code: "LIFECYCLE_GATE_BLOCKED",
      message: "Transition blocked",
      gate: {
        targetStatus: "ready-to-merge",
        failures: [{ workflowName: "e2e", status: "failed", runId: "r1" }],
      },
    },
  },
};

const WORK_ITEM: WorkItem = {
  id: "wi-1",
  project_id: "proj-1",
  title: "Test Item",
  description: null,
  status: "in-progress",
  priority: "p2",
  type: "story",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  metadata: null,
  executionConfig: {
    targetBranch: "feature/test",
    baseBranch: "main",
  },
} as unknown as WorkItem;

let mockMutateFn = vi.fn();
let mockMutationState: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
} = {
  isPending: false,
  isError: false,
  error: null,
};

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: vi.fn() }),
  useQuery: () => ({ data: ["main", "feature/test"] }),
  useMutation: (opts: { onSuccess?: (result: unknown) => void }) => {
    mockMutateFn = vi.fn(() => {
      if (!mockMutationState.isError) {
        opts.onSuccess?.({
          merge: { outcome: "failed", message: "err" },
          workItem: WORK_ITEM,
          triggeredRunIds: [],
        });
      }
      return Promise.resolve();
    });
    return {
      mutate: mockMutateFn,
      isPending: mockMutationState.isPending,
      isError: mockMutationState.isError,
      error: mockMutationState.error,
    };
  },
}));

describe("MergeWorkItemDialog – gate blocked state", () => {
  it("shows 'Blocked by checks' and failing workflow name when gate error occurs", () => {
    mockMutationState = {
      isPending: false,
      isError: true,
      error: GATE_BLOCKED_ERROR,
    };

    render(
      <MergeWorkItemDialog
        item={WORK_ITEM}
        open
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.getByText(/blocked by checks/i)).toBeTruthy();
    expect(screen.getByText(/e2e/)).toBeTruthy();
    expect(screen.queryByText(/merge failed/i)).toBeNull();
  });

  it("shows a 'View logs' link for failures that have a runId", () => {
    mockMutationState = {
      isPending: false,
      isError: true,
      error: GATE_BLOCKED_ERROR,
    };

    render(
      <MergeWorkItemDialog
        item={WORK_ITEM}
        open
        onOpenChange={() => undefined}
      />,
    );

    const link = screen.getByRole("link", { name: /view logs/i });
    expect(link).toBeTruthy();
    expect((link as HTMLAnchorElement).href).toContain("r1");
  });

  it("does NOT show the gate blocked alert for generic errors", () => {
    mockMutationState = {
      isPending: false,
      isError: true,
      error: { message: "Network error" },
    };

    render(
      <MergeWorkItemDialog
        item={WORK_ITEM}
        open
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.queryByText(/blocked by checks/i)).toBeNull();
    expect(screen.getByText(/merge failed/i)).toBeTruthy();
  });
});
