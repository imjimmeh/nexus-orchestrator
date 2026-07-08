// apps/web/src/hooks/useRoleAssignments.spec.tsx
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAssignRole, useRoles } from "./useRoleAssignments";
import { api } from "@/lib/api/client";
import type { RoleAssignment, Role } from "@/lib/api/client.scope.types";

vi.mock("@/lib/api/client", () => ({
  api: {
    assignRole: vi.fn(),
    getRoles: vi.fn(),
    getScopeMembers: vi.fn(),
  },
}));

const mockAssignment: RoleAssignment = {
  id: "a1",
  userId: "u1",
  userEmail: "alice@test.com",
  roleId: "r1",
  roleName: "member",
  scopeNodeId: "scope-1",
  scopeNodeName: "Engineering",
  isDirect: true,
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useAssignRole", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls api.assignRole and invalidates assignments", async () => {
    vi.mocked(api.assignRole).mockResolvedValue(mockAssignment);
    const { result } = renderHook(() => useAssignRole("scope-1"), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({ userId: "u1", roleId: "r1" });
    });
    expect(api.assignRole).toHaveBeenCalledWith("scope-1", {
      userId: "u1",
      roleId: "r1",
    });
  });

  it("invalidates the scope members query on success", async () => {
    vi.mocked(api.assignRole).mockResolvedValue(mockAssignment);
    vi.mocked(api.getScopeMembers).mockResolvedValue([]);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useAssignRole("scope-1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ userId: "u1", roleId: "r1" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["scope", "members", "scope-1"],
    });
  });
});

describe("useRoles", () => {
  it("fetches roles list", async () => {
    const mockRoles: Role[] = [
      { id: "r1", name: "member", ownerScopeNodeId: null },
    ];
    vi.mocked(api.getRoles).mockResolvedValue(mockRoles);
    const { result } = renderHook(() => useRoles(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockRoles);
  });
});
