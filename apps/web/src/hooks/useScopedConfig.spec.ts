import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useResolvedAgentProfile,
  useResolvedWorkflow,
  useForkAgentForScope,
} from "./useScopedConfig";

vi.mock("@/lib/api/client", () => ({
  api: {
    resolveAgentProfile: vi.fn(),
    resolveWorkflow: vi.fn(),
    forkAgentForScope: vi.fn(),
    forkWorkflowForScope: vi.fn(),
  },
}));

import { api } from "@/lib/api/client";
// Cast to any to access mock methods; Vitest stubs are applied via vi.mock above.

const mockApi = api as any;

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useScopedConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("useResolvedAgentProfile calls resolve endpoint", async () => {
    const fakeResult = {
      objectType: "agent_profile",
      name: "bot",
      scopeNodeId: "p1",
      value: { id: "x" },
      contributingLayers: [],
      isDefault: false,
      locked: false,
    };
    (mockApi.resolveAgentProfile as any).mockResolvedValue(fakeResult);
    const { result } = renderHook(() => useResolvedAgentProfile("bot", "p1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(fakeResult);
    expect(mockApi.resolveAgentProfile).toHaveBeenCalledWith("bot", "p1");
  });

  it("useResolvedWorkflow calls resolve endpoint", async () => {
    (mockApi.resolveWorkflow as any).mockResolvedValue({
      objectType: "workflow",
      value: {},
    });
    const { result } = renderHook(() => useResolvedWorkflow("my-wf", "p1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.resolveWorkflow).toHaveBeenCalledWith("my-wf", "p1");
  });

  it("useForkAgentForScope is a mutation that POSTs fork", async () => {
    (mockApi.forkAgentForScope as any).mockResolvedValue({ id: "new-id" });
    const { result } = renderHook(() => useForkAgentForScope(), { wrapper });
    result.current.mutate({
      baseProfileId: "base",
      scopeNodeId: "p1",
      data: {} as any,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApi.forkAgentForScope).toHaveBeenCalledWith("base", "p1", {});
  });
});
