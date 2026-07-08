// apps/web/src/components/scope/InviteDialog.spec.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { InviteDialog } from "./InviteDialog";
import { useRoles } from "@/hooks/useRoleAssignments";
import { useCreateInvitation } from "@/hooks/useInvitations";

const mockMutate = vi.fn();

vi.mock("@/hooks/useRoleAssignments", () => ({
  useRoles: vi.fn(),
}));
vi.mock("@/hooks/useInvitations", () => ({
  useCreateInvitation: vi.fn(),
}));

const invitationFixture = {
  id: "inv-1",
  scopeNodeId: "scope-1",
  roleId: "role-member",
  email: "carol@example.com",
  status: "pending" as const,
  expiresAt: "2026-08-01T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
};

function renderDialog(onClose = vi.fn()) {
  render(<InviteDialog scopeNodeId="scope-1" open onClose={onClose} />);
  return { onClose };
}

describe("InviteDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_PUBLIC_APP_URL", "https://app.example.com");
    vi.mocked(useRoles).mockReturnValue({
      data: [
        { id: "role-member", name: "Member", ownerScopeNodeId: null },
        { id: "role-admin", name: "Admin", ownerScopeNodeId: null },
      ],
    } as unknown as ReturnType<typeof useRoles>);
    vi.mocked(useCreateInvitation).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useCreateInvitation>);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders a role select, optional email input, and Send button", () => {
    renderDialog();

    expect(screen.getByLabelText(/^role$/i)).toBeTruthy();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^send$/i })).toBeTruthy();
  });

  it("disables Send until a role is selected", () => {
    renderDialog();

    const sendButton = screen.getByRole("button", { name: /^send$/i });
    expect(sendButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText(/^role$/i), {
      target: { value: "role-member" },
    });
    expect(sendButton.hasAttribute("disabled")).toBe(false);
  });

  it("submits with roleId only when email is left blank", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText(/^role$/i), {
      target: { value: "role-member" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      { roleId: "role-member" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("submits with roleId and email when email is provided", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText(/^role$/i), {
      target: { value: "role-member" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "carol@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      { roleId: "role-member", email: "carol@example.com" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("shows a copyable invite link built from the token on success", () => {
    mockMutate.mockImplementation((_vars, options) => {
      options.onSuccess({
        invitation: invitationFixture,
        inviteToken: "tok-secret-123",
      });
    });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/^role$/i), {
      target: { value: "role-member" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    const linkInput = screen.getByLabelText(/invite link/i) as HTMLInputElement;
    expect(linkInput.value).toBe(
      "https://app.example.com/accept-invite?token=tok-secret-123",
    );
    expect(linkInput.readOnly).toBe(true);
    // Never renders the raw token outside the built link.
    expect(screen.queryByText("tok-secret-123")).toBeNull();
  });

  it("copies the invite link to the clipboard when Copy is clicked", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mockMutate.mockImplementation((_vars, options) => {
      options.onSuccess({
        invitation: invitationFixture,
        inviteToken: "tok-secret-123",
      });
    });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/^role$/i), {
      target: { value: "role-member" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await user.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "https://app.example.com/accept-invite?token=tok-secret-123",
      );
    });
  });

  it("shows an error message when the mutation fails", () => {
    vi.mocked(useCreateInvitation).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof useCreateInvitation>);
    renderDialog();

    expect(screen.getByText(/failed to create invitation/i)).toBeTruthy();
  });

  it("calls onClose when Cancel is clicked", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
