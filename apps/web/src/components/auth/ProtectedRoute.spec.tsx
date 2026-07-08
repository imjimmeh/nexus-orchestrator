import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/auth.store";
import { ProtectedRoute } from "./ProtectedRoute";

const authMock = vi.hoisted(() =>
  vi.fn(() => ({
    isAuthenticated: true,
    hasRole: (role: string) => role === "admin",
    hasHydrated: true,
  })),
);

const getSetupStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAuth", () => ({
  useAuth: authMock,
}));

vi.mock("@/lib/api/client", () => ({
  api: {
    getSetupStatus: getSetupStatusMock,
  },
}));

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: {
        id: "admin-1",
        username: "admin",
        email: "admin@example.com",
        roles: ["admin"],
        isActive: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      accessToken: "token",
      refreshToken: "refresh",
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
  });

  it("redirects admins to /setup when setup is required", async () => {
    getSetupStatusMock.mockResolvedValue({ requiresSetup: true });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <div>Home page</div>
              </ProtectedRoute>
            }
          />
          <Route path="/setup" element={<div>Setup page</div>} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Setup page")).toBeTruthy();
    });
  });

  it("redirects users without required roles to /unauthorized", async () => {
    getSetupStatusMock.mockResolvedValue({ requiresSetup: false });
    useAuthStore.setState({
      user: {
        id: "user-1",
        username: "developer",
        email: "dev@example.com",
        roles: ["user"],
        isActive: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    });

    render(
      <MemoryRouter initialEntries={["/admin-only"]}>
        <Routes>
          <Route
            path="/admin-only"
            element={
              <ProtectedRoute requiredRoles={["admin"]}>
                <div>Admin page</div>
              </ProtectedRoute>
            }
          />
          <Route path="/unauthorized" element={<div>Unauthorized page</div>} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Unauthorized page")).toBeTruthy();
    });
  });
});
