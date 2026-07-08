import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import { useOrchestrationPolicy } from "./useOrchestrationPolicy";
import * as client from "@/lib/api/client.orchestration-policy";

vi.mock("@/lib/api/client.orchestration-policy", () => ({
  getOrchestrationPolicy: vi.fn(),
  updateOrchestrationPolicy: vi.fn(),
  applyOrchestrationPreset: vi.fn(),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe("useOrchestrationPolicy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches resolved policy for a project", async () => {
    vi.mocked(client.getOrchestrationPolicy).mockResolvedValue([
      {
        key: "autonomy.dispatch",
        value: "auto",
        layer: "default",
        defaultValue: "auto",
        descriptor: {
          key: "autonomy.dispatch",
          valueType: "string",
          enumValues: ["auto", "ask", "off"],
          group: "autonomy",
          label: "Dispatch",
          description: "",
        },
      },
    ]);

    const { result } = renderHook(() => useOrchestrationPolicy("p-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].key).toBe("autonomy.dispatch");
  });

  it("does not fetch without a projectId", () => {
    renderHook(() => useOrchestrationPolicy(""), {
      wrapper: createWrapper(),
    });

    expect(client.getOrchestrationPolicy).not.toHaveBeenCalled();
  });
});
