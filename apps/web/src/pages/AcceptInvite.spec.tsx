// apps/web/src/pages/AcceptInvite.spec.tsx
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcceptInvite } from "./AcceptInvite";
import { useAcceptInvitation } from "@/hooks/useAcceptInvitation";
import { useAuthStore } from "@/stores/auth.store";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );

  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/hooks/useAcceptInvitation", () => ({
  useAcceptInvitation: vi.fn(),
}));

function renderAcceptInvite(token: string | null = "tok-123") {
  const path = token ? `/accept-invite?token=${token}` : "/accept-invite";

  render(
    <MemoryRouter initialEntries={[path]}>
      <AcceptInvite />
    </MemoryRouter>,
  );
}

describe("AcceptInvite page", () => {
  const mockMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
    vi.mocked(useAcceptInvitation).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useAcceptInvitation>);
  });

  it("shows an error and renders no form when the token is missing from the URL", () => {
    renderAcceptInvite(null);

    expect(
      screen.getByText(/invitation link is missing a token/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  describe("when logged in", () => {
    beforeEach(() => {
      useAuthStore.setState({ isAuthenticated: true });
    });

    it("renders a one-click accept button that calls mutate with just the token", () => {
      renderAcceptInvite("tok-123");

      fireEvent.click(
        screen.getByRole("button", { name: /accept invitation/i }),
      );

      expect(mockMutate.mock.calls[0][0]).toEqual({ token: "tok-123" });
    });

    it("persists the returned tokens into the auth store and navigates to / on success", () => {
      renderAcceptInvite("tok-123");

      fireEvent.click(
        screen.getByRole("button", { name: /accept invitation/i }),
      );

      const [, options] = mockMutate.mock.calls[0];
      act(() => {
        options.onSuccess({
          userId: "u1",
          accessToken: "acc-1",
          refreshToken: "ref-1",
        });
      });

      expect(useAuthStore.getState().accessToken).toBe("acc-1");
      expect(useAuthStore.getState().refreshToken).toBe("ref-1");
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(navigateMock).toHaveBeenCalledWith("/");
    });

    it("shows a generic invalid/expired message on failure (never leaks backend detail)", () => {
      renderAcceptInvite("tok-123");

      fireEvent.click(
        screen.getByRole("button", { name: /accept invitation/i }),
      );

      const [, options] = mockMutate.mock.calls[0];
      act(() => {
        options.onError(new Error("some backend implementation detail"));
      });

      expect(screen.getByText(/invalid or has expired/i)).toBeTruthy();
      expect(
        screen.queryByText(/some backend implementation detail/i),
      ).toBeNull();
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it("disables the accept button while the mutation is pending", () => {
      vi.mocked(useAcceptInvitation).mockReturnValue({
        mutate: mockMutate,
        isPending: true,
      } as unknown as ReturnType<typeof useAcceptInvitation>);

      renderAcceptInvite("tok-123");

      expect(screen.getByRole("button", { name: /accept/i })).toHaveProperty(
        "disabled",
        true,
      );
    });
  });

  describe("when not logged in", () => {
    it("renders a username/password form and calls mutate with token + credentials on submit", async () => {
      renderAcceptInvite("tok-123");

      fireEvent.change(screen.getByLabelText(/username/i), {
        target: { value: "alice" },
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: "Password123!" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: /accept invitation/i }),
      );

      await waitFor(() => expect(mockMutate).toHaveBeenCalled());
      expect(mockMutate.mock.calls[0][0]).toEqual({
        token: "tok-123",
        username: "alice",
        password: "Password123!",
      });
    });

    it("persists the returned tokens and navigates to / on success", async () => {
      renderAcceptInvite("tok-123");

      fireEvent.change(screen.getByLabelText(/username/i), {
        target: { value: "alice" },
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: "Password123!" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: /accept invitation/i }),
      );

      await waitFor(() => expect(mockMutate).toHaveBeenCalled());
      const [, options] = mockMutate.mock.calls[0];
      act(() => {
        options.onSuccess({
          userId: "u2",
          accessToken: "acc-2",
          refreshToken: "ref-2",
        });
      });

      expect(useAuthStore.getState().accessToken).toBe("acc-2");
      expect(useAuthStore.getState().refreshToken).toBe("ref-2");
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(navigateMock).toHaveBeenCalledWith("/");
    });
  });
});
