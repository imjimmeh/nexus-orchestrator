// apps/web/src/hooks/useEffectivePermissions.spec.tsx
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { useEffectivePermissions } from "./useEffectivePermissions";
import { api } from "@/lib/api/client";
import { useScopeContext } from "@/context/ScopeContext";

vi.mock("@/lib/api/client", () => ({
  api: { getMyPermissions: vi.fn() },
}));

vi.mock("@/context/ScopeContext", () => ({
  useScopeContext: vi.fn(),
}));

function qcWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe("useEffectivePermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useScopeContext).mockReturnValue({
      activeScopeNodeId: "active-scope",
      activeScopePath: ["Platform"],
      setActiveScopeNodeId: vi.fn(),
      setScopePath: vi.fn(),
      isScopePanelOpen: false,
      toggleScopePanel: vi.fn(),
    });
  });

  it("returns effective permissions for the active scope", async () => {
    (api.getMyPermissions as Mock).mockResolvedValue({
      permissions: ["workflows:read", "agents:manage"],
      scopeNodeId: "n1",
    });
    const { result } = renderHook(() => useEffectivePermissions("n1"), {
      wrapper: qcWrapper(),
    });
    await waitFor(() =>
      expect(result.current.permissions).toContain("agents:manage"),
    );
    expect(api.getMyPermissions).toHaveBeenCalledWith("n1");
  });

  it("returns an empty list while loading", () => {
    (api.getMyPermissions as Mock).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useEffectivePermissions("n1"), {
      wrapper: qcWrapper(),
    });
    expect(result.current.permissions).toEqual([]);
  });

  it("defaults to the active scope node when scopeNodeId is omitted", async () => {
    (api.getMyPermissions as Mock).mockResolvedValue({
      permissions: ["scopes:manage"],
      scopeNodeId: "active-scope",
    });
    const { result } = renderHook(() => useEffectivePermissions(), {
      wrapper: qcWrapper(),
    });
    await waitFor(() =>
      expect(result.current.permissions).toContain("scopes:manage"),
    );
    expect(api.getMyPermissions).toHaveBeenCalledWith("active-scope");
  });
});
