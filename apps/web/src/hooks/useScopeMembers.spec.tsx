// apps/web/src/hooks/useScopeMembers.spec.tsx
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useScopeMembers, useRevokeScopeMember } from "./useScopeMembers";
import { api } from "@/lib/api/client";
import type { EffectiveMember } from "@/lib/api/client.scope.types";

vi.mock("@/lib/api/client", () => ({
  api: {
    getScopeMembers: vi.fn(),
    revokeMemberRole: vi.fn(),
  },
}));

const mockMember: EffectiveMember = {
  userId: "u1",
  userEmail: "alice@test.com",
  roleId: "r1",
  roleName: "member",
  source: "direct",
  sourceScopeNodeId: "scope-1",
  sourceScopeName: "Engineering",
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useScopeMembers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches effective members for a scope node", async () => {
    vi.mocked(api.getScopeMembers).mockResolvedValue([mockMember]);
    const { result } = renderHook(() => useScopeMembers("scope-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getScopeMembers).toHaveBeenCalledWith("scope-1");
    expect(result.current.data).toEqual([mockMember]);
  });

  it("is disabled when scopeNodeId is empty", () => {
    vi.mocked(api.getScopeMembers).mockResolvedValue([]);
    const { result } = renderHook(() => useScopeMembers(""), {
      wrapper: makeWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(api.getScopeMembers).not.toHaveBeenCalled();
  });
});

describe("useRevokeScopeMember", () => {
  it("calls api.revokeMemberRole and invalidates the members query", async () => {
    vi.mocked(api.revokeMemberRole).mockResolvedValue(undefined);
    vi.mocked(api.getScopeMembers).mockResolvedValue([]);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useRevokeScopeMember("scope-1"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ userId: "u1", roleId: "r1" });
    });

    expect(api.revokeMemberRole).toHaveBeenCalledWith("scope-1", {
      userId: "u1",
      roleId: "r1",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["scope", "members", "scope-1"],
    });
  });
});
