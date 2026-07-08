import { createElement, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useExecutionSidebarData } from "./useExecutionSidebarData";

vi.mock("@/hooks/useWorkflowRunTelemetry", () => ({
  useWorkflowRunTelemetry: () => ({
    events: [
      {
        event_type: "workspace_tree",
        timestamp: "2026-04-24T10:00:00.000Z",
        payload: {
          tree: [
            {
              name: "src",
              path: "src",
              type: "directory",
              children: [],
            },
          ],
        },
      },
      {
        event_type: "workspace_diff",
        timestamp: "2026-04-24T10:00:01.000Z",
        payload: {
          diff: "telemetry-diff",
        },
      },
    ],
  }),
}));

describe("useExecutionSidebarData", () => {
  it("prefers artifact API data over telemetry fallbacks", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () =>
        useExecutionSidebarData("run-1", {
          workspaceDiff: { diff: "artifact-diff" },
          workspaceTree: [
            {
              name: "apps",
              path: "apps",
              type: "directory",
              children: [],
            },
          ],
          workspaceDiffLoading: true,
          workspaceTreeLoading: true,
          workspaceDiffError: new Error("diff failed"),
          workspaceTreeError: "tree failed",
        }),
      { wrapper },
    );

    expect(result.current.workspaceDiff).toBe("artifact-diff");
    expect(result.current.workspaceTree).toHaveLength(1);
    expect(result.current.diffLoading).toBe(true);
    expect(result.current.treeLoading).toBe(true);
    expect(result.current.diffError).toBe("diff failed");
    expect(result.current.treeError).toBe("tree failed");
  });
});
