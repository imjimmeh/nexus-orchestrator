// apps/web/src/components/scope/PendingInvitationsList.spec.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PendingInvitationsList } from "./PendingInvitationsList";
import { useInvitations, useRevokeInvitation } from "@/hooks/useInvitations";
import type { Invitation } from "@/lib/api/client.invitations.types";

const mockRevokeMutate = vi.fn();

vi.mock("@/hooks/useInvitations", () => ({
  useInvitations: vi.fn(),
  useRevokeInvitation: vi.fn(),
}));

const emailInvite: Invitation = {
  id: "inv-1",
  scopeNodeId: "scope-1",
  roleId: "role-member",
  roleName: "Member",
  email: "carol@example.com",
  status: "pending",
  expiresAt: "2026-08-01T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const linkOnlyInvite: Invitation = {
  id: "inv-2",
  scopeNodeId: "scope-1",
  roleId: "role-admin",
  roleName: undefined,
  email: null,
  status: "pending",
  expiresAt: "2026-08-02T00:00:00.000Z",
  createdAt: "2026-07-02T00:00:00.000Z",
};

function renderList() {
  render(<PendingInvitationsList scopeNodeId="scope-1" />);
}

describe("PendingInvitationsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRevokeInvitation).mockReturnValue({
      mutate: mockRevokeMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useRevokeInvitation>);
  });

  it("renders one row per pending invitation with role, email, and expiry", () => {
    vi.mocked(useInvitations).mockReturnValue({
      data: [emailInvite, linkOnlyInvite],
      isLoading: false,
    } as unknown as ReturnType<typeof useInvitations>);

    renderList();

    expect(screen.getByText("carol@example.com")).toBeTruthy();
    expect(screen.getByText("Member")).toBeTruthy();
    expect(screen.getByText(/link-only/i)).toBeTruthy();
    // Falls back to roleId when roleName is undefined (API doesn't join it yet).
    expect(screen.getByText("role-admin")).toBeTruthy();
  });

  it("shows an empty state when there are no pending invitations", () => {
    vi.mocked(useInvitations).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useInvitations>);

    renderList();

    expect(screen.getByText(/no pending invitations/i)).toBeTruthy();
  });

  it("calls useRevokeInvitation.mutate with the invitation id when Revoke is clicked", () => {
    vi.mocked(useInvitations).mockReturnValue({
      data: [emailInvite],
      isLoading: false,
    } as unknown as ReturnType<typeof useInvitations>);

    renderList();

    fireEvent.click(screen.getByRole("button", { name: /revoke/i }));

    expect(mockRevokeMutate).toHaveBeenCalledWith("inv-1");
  });

  it("does not crash and renders nothing while loading", () => {
    vi.mocked(useInvitations).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useInvitations>);

    renderList();

    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
  });
});
