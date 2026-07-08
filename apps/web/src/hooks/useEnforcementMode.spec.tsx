// apps/web/src/hooks/useEnforcementMode.spec.tsx
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useEnforcementModes,
  useSetEnforcementMode,
} from "./useEnforcementMode";
import { api } from "@/lib/api/client";
import type { ResourceEnforcementMode } from "@/lib/api/client.authz.types";

vi.mock("@/lib/api/client", () => ({
  api: { getEnforcementModes: vi.fn(), setEnforcementMode: vi.fn() },
}));

const mockModes: ResourceEnforcementMode[] = [
  { resource: "workflows", mode: "audit" },
  { resource: "secrets", mode: "enforce" },
];

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useEnforcementModes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns enforcement mode list", async () => {
    vi.mocked(api.getEnforcementModes).mockResolvedValue(mockModes);
    const { result } = renderHook(() => useEnforcementModes(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockModes);
  });
});

describe("useSetEnforcementMode", () => {
  it("calls api.setEnforcementMode", async () => {
    vi.mocked(api.setEnforcementMode).mockResolvedValue({
      resource: "workflows",
      mode: "enforce",
    });
    vi.mocked(api.getEnforcementModes).mockResolvedValue([]);
    const { result } = renderHook(() => useSetEnforcementMode(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({
        resource: "workflows",
        mode: "enforce",
      });
    });
    expect(api.setEnforcementMode).toHaveBeenCalledWith("workflows", "enforce");
  });
});
