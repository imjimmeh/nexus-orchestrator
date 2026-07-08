// apps/web/src/hooks/useInvitations.spec.tsx
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useInvitations,
  useCreateInvitation,
  useRevokeInvitation,
} from "./useInvitations";
import { api } from "@/lib/api/client";
import type {
  Invitation,
  CreateInvitationResult,
} from "@/lib/api/client.invitations.types";

vi.mock("@/lib/api/client", () => ({
  api: {
    createInvitation: vi.fn(),
    getInvitations: vi.fn(),
    revokeInvitation: vi.fn(),
  },
}));

const mockInvitation: Invitation = {
  id: "inv-1",
  scopeNodeId: "scope-1",
  roleId: "r1",
  roleName: "member",
  email: "bob@test.com",
  status: "pending",
  expiresAt: "2026-08-01T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const mockCreateResult: CreateInvitationResult = {
  invitation: mockInvitation,
  inviteToken: "token-abc",
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useInvitations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches invitations for a scope node", async () => {
    vi.mocked(api.getInvitations).mockResolvedValue([mockInvitation]);
    const { result } = renderHook(() => useInvitations("scope-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getInvitations).toHaveBeenCalledWith("scope-1");
    expect(result.current.data).toEqual([mockInvitation]);
  });

  it("is disabled when scopeNodeId is empty", () => {
    vi.mocked(api.getInvitations).mockResolvedValue([]);
    const { result } = renderHook(() => useInvitations(""), {
      wrapper: makeWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(api.getInvitations).not.toHaveBeenCalled();
  });
});

describe("useCreateInvitation", () => {
  it("calls api.createInvitation and invalidates the invitations query", async () => {
    vi.mocked(api.createInvitation).mockResolvedValue(mockCreateResult);
    vi.mocked(api.getInvitations).mockResolvedValue([]);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useCreateInvitation("scope-1"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ roleId: "r1", email: "bob@test.com" });
    });

    expect(api.createInvitation).toHaveBeenCalledWith("scope-1", {
      roleId: "r1",
      email: "bob@test.com",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["invitations", "scope-1"],
    });
  });
});

describe("useRevokeInvitation", () => {
  it("calls api.revokeInvitation and invalidates the invitations query", async () => {
    vi.mocked(api.revokeInvitation).mockResolvedValue(undefined);
    vi.mocked(api.getInvitations).mockResolvedValue([]);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useRevokeInvitation("scope-1"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync("inv-1");
    });

    expect(api.revokeInvitation).toHaveBeenCalledWith("inv-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["invitations", "scope-1"],
    });
  });
});
