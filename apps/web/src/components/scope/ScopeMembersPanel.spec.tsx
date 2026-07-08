// apps/web/src/components/scope/ScopeMembersPanel.spec.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ScopeMembersPanel } from "./ScopeMembersPanel";
import { useScopeMembers, useRevokeScopeMember } from "@/hooks/useScopeMembers";
import { useUserSearch } from "@/hooks/useUserSearch";
import { useAssignRole, useRoles } from "@/hooks/useRoleAssignments";
import {
  useInvitations,
  useCreateInvitation,
  useRevokeInvitation,
} from "@/hooks/useInvitations";

const mockRevokeMutateAsync = vi.fn();
const mockAssignMutateAsync = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockRevokeInvitationMutate = vi.fn();
const mockCreateInvitationMutate = vi.fn();

vi.mock("@/hooks/useScopeMembers", () => ({
  useScopeMembers: vi.fn(),
  useRevokeScopeMember: vi.fn(),
}));
vi.mock("@/hooks/useUserSearch", () => ({ useUserSearch: vi.fn() }));
vi.mock("@/hooks/useRoleAssignments", () => ({
  useAssignRole: vi.fn(),
  useRoles: vi.fn(),
}));
vi.mock("@/hooks/useInvitations", () => ({
  useInvitations: vi.fn(),
  useCreateInvitation: vi.fn(),
  useRevokeInvitation: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

const directMember = {
  userId: "u1",
  userEmail: "direct@x.com",
  roleId: "r1",
  roleName: "member",
  source: "direct" as const,
  sourceScopeNodeId: "s1",
  sourceScopeName: "Team",
};

const inheritedMember = {
  userId: "u2",
  userEmail: "inherited@x.com",
  roleId: "r2",
  roleName: "platform_admin",
  source: "inherited" as const,
  sourceScopeNodeId: "root",
  sourceScopeName: "Platform",
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ScopeMembersPanel scopeNodeId="s1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ScopeMembersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useScopeMembers).mockReturnValue({
      data: [directMember, inheritedMember],
      isLoading: false,
    } as unknown as ReturnType<typeof useScopeMembers>);
    vi.mocked(useRevokeScopeMember).mockReturnValue({
      mutateAsync: mockRevokeMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useRevokeScopeMember>);
    vi.mocked(useUserSearch).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useUserSearch>);
    vi.mocked(useAssignRole).mockReturnValue({
      mutateAsync: mockAssignMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useAssignRole>);
    vi.mocked(useRoles).mockReturnValue({
      data: [{ id: "r1", name: "member", ownerScopeNodeId: null }],
    } as unknown as ReturnType<typeof useRoles>);
    vi.mocked(useInvitations).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useInvitations>);
    vi.mocked(useRevokeInvitation).mockReturnValue({
      mutate: mockRevokeInvitationMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useRevokeInvitation>);
    vi.mocked(useCreateInvitation).mockReturnValue({
      mutate: mockCreateInvitationMutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useCreateInvitation>);
  });

  it("renders direct and inherited members in separate sections", () => {
    renderPanel();
    expect(screen.getByText("direct@x.com")).toBeTruthy();
    expect(screen.getByText("inherited@x.com")).toBeTruthy();
    expect(screen.getByText(/↑ Platform/)).toBeTruthy();
  });

  it("opens the invite dialog when the Invite button is clicked", () => {
    renderPanel();
    const invite = screen.getByRole("button", { name: /Invite/i });
    expect(invite.hasAttribute("disabled")).toBe(false);

    expect(screen.queryByText(/invite a member/i)).toBeNull();
    fireEvent.click(invite);
    expect(screen.getByText(/invite a member/i)).toBeTruthy();
  });

  it("does not render a revoke action for inherited members", () => {
    renderPanel();
    const inheritedRow = screen.getByText("inherited@x.com").closest("tr");
    expect(inheritedRow?.querySelector("button")).toBeNull();
  });

  it("revokes a direct member when the revoke action is clicked", () => {
    mockRevokeMutateAsync.mockResolvedValue(undefined);
    renderPanel();
    const directRow = screen.getByText("direct@x.com").closest("tr");
    const revokeButton = directRow?.querySelector("button");
    expect(revokeButton).not.toBeNull();
    fireEvent.click(revokeButton as HTMLButtonElement);
    expect(mockRevokeMutateAsync).toHaveBeenCalledWith({
      userId: "u1",
      roleId: "r1",
    });
  });

  it("adds a member via the user-picker autocomplete", async () => {
    const user = userEvent.setup();
    vi.mocked(useUserSearch).mockReturnValue({
      data: [{ id: "u3", username: "carol", email: "carol@x.com" }],
      isLoading: false,
    } as unknown as ReturnType<typeof useUserSearch>);
    mockAssignMutateAsync.mockResolvedValue(undefined);
    renderPanel();

    await user.type(
      screen.getByPlaceholderText(/search by name or email/i),
      "carol",
    );
    await user.click(screen.getByText("carol@x.com"));

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "member" }));

    await user.click(screen.getByRole("button", { name: /^Add$/i }));

    await waitFor(() => {
      expect(mockAssignMutateAsync).toHaveBeenCalledWith({
        userId: "u3",
        roleId: "r1",
      });
    });
  });

  it("renders a distinct row per role when a user holds multiple roles at the same scope", () => {
    const secondRoleMember = {
      ...directMember,
      roleId: "r9",
      roleName: "admin",
    };
    vi.mocked(useScopeMembers).mockReturnValue({
      data: [directMember, secondRoleMember],
      isLoading: false,
    } as unknown as ReturnType<typeof useScopeMembers>);
    mockRevokeMutateAsync.mockResolvedValue(undefined);
    renderPanel();

    // Both roles render (same user email appears twice, two distinct rows).
    expect(screen.getAllByText("direct@x.com")).toHaveLength(2);
    expect(screen.getByText("member")).toBeTruthy();
    expect(screen.getByText("admin")).toBeTruthy();

    // The second role's row revoke must target THAT row's roleId, not the first.
    const adminRow = screen.getByText("admin").closest("tr");
    const adminRevoke = adminRow?.querySelector("button");
    expect(adminRevoke).not.toBeNull();
    fireEvent.click(adminRevoke as HTMLButtonElement);
    expect(mockRevokeMutateAsync).toHaveBeenCalledWith({
      userId: "u1",
      roleId: "r9",
    });
  });

  it("has no raw user-id text input", () => {
    renderPanel();
    expect(screen.queryByPlaceholderText(/user id/i)).toBeNull();
  });
});
