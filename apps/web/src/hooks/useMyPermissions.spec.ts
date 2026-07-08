// apps/web/src/hooks/useMyPermissions.spec.ts
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMyPermissions } from "./useMyPermissions";
import { api } from "@/lib/api/client";
import type { MyPermissionsResponse } from "@/lib/api/client.authz.types";

vi.mock("@/lib/api/client", () => ({
  api: { getMyPermissions: vi.fn() },
}));

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe("useMyPermissions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches permissions at the given scope", async () => {
    const response: MyPermissionsResponse = {
      scopeNodeId: "n1",
      permissions: ["scopes:manage"],
    };
    vi.mocked(api.getMyPermissions).mockResolvedValue(response);

    const { result } = renderHook(() => useMyPermissions("n1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.getMyPermissions).toHaveBeenCalledWith("n1");
    expect(result.current.permissions).toEqual(["scopes:manage"]);
  });

  it("can() honours the <resource>:manage wildcard", async () => {
    vi.mocked(api.getMyPermissions).mockResolvedValue({
      scopeNodeId: "n1",
      permissions: ["scopes:manage"],
    });

    const { result } = renderHook(() => useMyPermissions("n1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.can("scopes:create")).toBe(true);
    expect(result.current.can("users:create")).toBe(false);
  });

  it("can() returns true for an exact permission match", async () => {
    vi.mocked(api.getMyPermissions).mockResolvedValue({
      scopeNodeId: "n1",
      permissions: ["users:create"],
    });

    const { result } = renderHook(() => useMyPermissions("n1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.can("users:create")).toBe(true);
    expect(result.current.can("users:delete")).toBe(false);
  });

  it("is disabled and reports no permissions for an empty scopeNodeId", () => {
    const { result } = renderHook(() => useMyPermissions(""), {
      wrapper: makeWrapper(),
    });

    expect(api.getMyPermissions).not.toHaveBeenCalled();
    expect(result.current.permissions).toEqual([]);
    expect(result.current.can("scopes:create")).toBe(false);
  });
});
