import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api/client";
import {
  getAutonomyDiagnosticsRefetchInterval,
  useWorkflowLifecycleResults,
} from "./useWorkflows";

vi.mock("@/lib/api/client", () => ({
  api: {
    getWorkflowLifecycleResults: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe("getAutonomyDiagnosticsRefetchInterval", () => {
  it("polls while autonomy diagnostics can still appear", () => {
    expect(getAutonomyDiagnosticsRefetchInterval("PENDING")).toBe(2000);
    expect(getAutonomyDiagnosticsRefetchInterval("RUNNING")).toBe(2000);
    expect(getAutonomyDiagnosticsRefetchInterval("FAILED")).toBe(2000);
  });

  it("does not poll for missing or terminal settled statuses", () => {
    expect(getAutonomyDiagnosticsRefetchInterval(undefined)).toBe(false);
    expect(getAutonomyDiagnosticsRefetchInterval("COMPLETED")).toBe(false);
    expect(getAutonomyDiagnosticsRefetchInterval("CANCELLED")).toBe(false);
  });
});

describe("useWorkflowLifecycleResults", () => {
  it("does not call the API without a scope", () => {
    renderHook(() => useWorkflowLifecycleResults(null), {
      wrapper: createWrapper(),
    });

    expect(api.getWorkflowLifecycleResults).not.toHaveBeenCalled();
  });
});
