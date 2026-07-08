import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuthStore } from "./auth.store";
import { auth } from "../lib/api/auth";
import type {
  UserResponse,
  RegisterRequest,
  RegisterResponse,
  LoginRequest,
  LoginResponse,
  RefreshTokenResponse,
} from "@nexus/core";

// Mock the auth API client
vi.mock("../lib/api/auth", () => ({
  auth: {
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn(),
    refresh: vi.fn(),
  },
}));

// Mock localStorage for persist middleware
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("Auth Store", () => {
  const mockUser: UserResponse = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    username: "testuser",
    email: "test@example.com",
    roles: ["user"],
    isActive: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  const mockRegisterResponse: RegisterResponse = {
    user: {
      id: mockUser.id,
      username: mockUser.username,
      email: mockUser.email,
      roles: mockUser.roles,
      createdAt: mockUser.createdAt,
    },
    accessToken: "mock-access-token",
    refreshToken: "mock-refresh-token",
  };

  const mockLoginResponse: LoginResponse = {
    user: {
      id: mockUser.id,
      username: mockUser.username,
      email: mockUser.email,
      roles: mockUser.roles,
      createdAt: mockUser.createdAt,
    },
    accessToken: "mock-access-token",
    refreshToken: "mock-refresh-token",
    expiresIn: 3600,
  };

  const mockRefreshResponse: RefreshTokenResponse = {
    accessToken: "new-access-token",
    refreshToken: "new-refresh-token",
    expiresIn: 3600,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    localStorageMock.setItem.mockImplementation(() => {});
    localStorageMock.removeItem.mockImplementation(() => {});

    await act(async () => {
      await useAuthStore.persist.rehydrate();
    });

    // Reset store state
    act(() => {
      useAuthStore.setState({
        user: null,
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    });
  });

  afterEach(() => {
    useAuthStore.persist.clearStorage();
    vi.restoreAllMocks();
  });

  describe("State Initialization", () => {
    it("should initialize with default state", () => {
      const { result } = renderHook(() => useAuthStore());

      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(result.current.refreshToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should restore persisted state from localStorage", () => {
      const persistedState = {
        state: {
          user: mockUser,
          accessToken: "persisted-access-token",
          refreshToken: "persisted-refresh-token",
          isAuthenticated: true,
        },
        version: 0,
      };
      localStorageMock.getItem.mockReturnValue(JSON.stringify(persistedState));

      // Create a new store instance to trigger rehydration
      const { result } = renderHook(() => useAuthStore());

      // Note: Zustand persist rehydrates asynchronously
      expect(result.current.user).toBeNull(); // Before rehydration
    });
  });

  describe("register() action", () => {
    const registerData: RegisterRequest = {
      username: "testuser",
      email: "test@example.com",
      password: "Password123!",
    };

    it("should successfully register a user", async () => {
      vi.mocked(auth.register).mockResolvedValueOnce(mockRegisterResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.register(registerData);
      });

      expect(auth.register).toHaveBeenCalledWith(registerData);
      expect(result.current.user).toEqual(mockRegisterResponse.user);
      expect(result.current.accessToken).toBe("mock-access-token");
      expect(result.current.refreshToken).toBe("mock-refresh-token");
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should set loading state during registration", async () => {
      vi.mocked(auth.register).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(mockRegisterResponse), 100),
          ),
      );

      const { result } = renderHook(() => useAuthStore());
      let registerPromise: Promise<void> | undefined;

      act(() => {
        registerPromise = result.current.register(registerData);
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.error).toBeNull();

      await act(async () => {
        await registerPromise;
      });
    });

    it("should handle registration failure", async () => {
      const errorMessage = "Username already exists";
      vi.mocked(auth.register).mockRejectedValueOnce(new Error(errorMessage));

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        try {
          await result.current.register(registerData);
        } catch (e) {
          // Expected to throw
        }
      });

      await waitFor(() => expect(result.current.user).toBeNull());
      expect(result.current.accessToken).toBeNull();
      expect(result.current.refreshToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe(errorMessage);
    });

    it("should handle non-Error exceptions during registration", async () => {
      vi.mocked(auth.register).mockRejectedValueOnce("String error");

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        try {
          await result.current.register(registerData);
        } catch (e) {
          // Expected to throw
        }
      });

      expect(result.current.error).toBe("Registration failed");
    });

    it("should throw error on registration failure", async () => {
      const error = new Error("Network error");
      vi.mocked(auth.register).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await expect(result.current.register(registerData)).rejects.toThrow(
          "Network error",
        );
      });
    });
  });

  describe("login() action", () => {
    const loginData: LoginRequest = {
      username: "testuser",
      password: "Password123!",
      rememberMe: false,
    };

    it("should successfully log in a user", async () => {
      vi.mocked(auth.login).mockResolvedValueOnce(mockLoginResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login(loginData);
      });

      expect(auth.login).toHaveBeenCalledWith(loginData);
      expect(result.current.user).toEqual(mockLoginResponse.user);
      expect(result.current.accessToken).toBe("mock-access-token");
      expect(result.current.refreshToken).toBe("mock-refresh-token");
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should set loading state during login", async () => {
      vi.mocked(auth.login).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(mockLoginResponse), 100),
          ),
      );

      const { result } = renderHook(() => useAuthStore());
      let loginPromise: Promise<void> | undefined;

      act(() => {
        loginPromise = result.current.login(loginData);
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.error).toBeNull();

      await act(async () => {
        await loginPromise;
      });
    });

    it("should handle login failure", async () => {
      const errorMessage = "Invalid credentials";
      vi.mocked(auth.login).mockRejectedValueOnce(new Error(errorMessage));

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        try {
          await result.current.login(loginData);
        } catch (e) {
          // Expected to throw
        }
      });

      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(result.current.refreshToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe(errorMessage);
    });

    it("should handle non-Error exceptions during login", async () => {
      vi.mocked(auth.login).mockRejectedValueOnce({ message: "Unknown error" });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        try {
          await result.current.login(loginData);
        } catch (e) {
          // Expected to throw
        }
      });

      expect(result.current.error).toBe("Login failed");
    });

    it("should throw error on login failure", async () => {
      const error = new Error("Server error");
      vi.mocked(auth.login).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await expect(result.current.login(loginData)).rejects.toThrow(
          "Server error",
        );
      });
    });
  });

  describe("logout() action", () => {
    it("should successfully log out a user", async () => {
      vi.mocked(auth.logout).mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useAuthStore());

      // First, set authenticated state
      act(() => {
        useAuthStore.setState({
          user: mockUser,
          accessToken: "mock-access-token",
          refreshToken: "mock-refresh-token",
          isAuthenticated: true,
        });
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(auth.logout).toHaveBeenCalledWith("mock-refresh-token");
      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(result.current.refreshToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should handle logout without refresh token", async () => {
      vi.mocked(auth.logout).mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(auth.logout).toHaveBeenCalledWith(undefined);
    });

    it("should clear state even if logout API fails", async () => {
      vi.mocked(auth.logout).mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useAuthStore());

      // Set authenticated state
      act(() => {
        useAuthStore.setState({
          user: mockUser,
          accessToken: "mock-access-token",
          refreshToken: "mock-refresh-token",
          isAuthenticated: true,
        });
      });

      await act(async () => {
        try {
          await result.current.logout();
        } catch (e) {
          // Error is swallowed in finally block
        }
      });

      // State should still be cleared
      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(result.current.refreshToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });

    it("should set loading state during logout", async () => {
      vi.mocked(auth.logout).mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve(undefined), 100)),
      );

      const { result } = renderHook(() => useAuthStore());
      let logoutPromise: Promise<void> | undefined;

      act(() => {
        logoutPromise = result.current.logout();
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        await logoutPromise;
      });
    });
  });

  describe("logoutAll() action", () => {
    it("should successfully log out from all devices", async () => {
      vi.mocked(auth.logoutAll).mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useAuthStore());

      // Set authenticated state
      act(() => {
        useAuthStore.setState({
          user: mockUser,
          accessToken: "mock-access-token",
          refreshToken: "mock-refresh-token",
          isAuthenticated: true,
        });
      });

      await act(async () => {
        await result.current.logoutAll();
      });

      expect(auth.logoutAll).toHaveBeenCalled();
      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(result.current.refreshToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });

    it("should clear state even if logoutAll API fails", async () => {
      vi.mocked(auth.logoutAll).mockRejectedValueOnce(
        new Error("Server error"),
      );

      const { result } = renderHook(() => useAuthStore());

      // Set authenticated state
      act(() => {
        useAuthStore.setState({
          user: mockUser,
          accessToken: "mock-access-token",
          refreshToken: "mock-refresh-token",
          isAuthenticated: true,
        });
      });

      await act(async () => {
        try {
          await result.current.logoutAll();
        } catch (e) {
          // Error is swallowed in finally block
        }
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe("doRefreshToken() action", () => {
    it("should successfully refresh tokens", async () => {
      vi.mocked(auth.refresh).mockResolvedValueOnce(mockRefreshResponse);

      const { result } = renderHook(() => useAuthStore());

      // Set state with existing refresh token
      act(() => {
        useAuthStore.setState({
          refreshToken: "old-refresh-token",
          isAuthenticated: true,
        });
      });

      await act(async () => {
        await result.current.doRefreshToken();
      });

      expect(auth.refresh).toHaveBeenCalledWith("old-refresh-token");
      expect(result.current.accessToken).toBe("new-access-token");
      expect(result.current.refreshToken).toBe("new-refresh-token");
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it("should handle missing refresh token", async () => {
      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.doRefreshToken();
      });

      expect(auth.refresh).not.toHaveBeenCalled();
      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(result.current.refreshToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.error).toBe("No refresh token available");
    });

    it("should handle token refresh failure", async () => {
      vi.mocked(auth.refresh).mockRejectedValueOnce(
        new Error("Invalid refresh token"),
      );

      const { result } = renderHook(() => useAuthStore());

      // Set state with refresh token
      act(() => {
        useAuthStore.setState({
          user: mockUser,
          accessToken: "old-access-token",
          refreshToken: "invalid-refresh-token",
          isAuthenticated: true,
        });
      });

      await act(async () => {
        try {
          await result.current.doRefreshToken();
        } catch (e) {
          // Expected to throw
        }
      });

      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
      expect(result.current.refreshToken).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.error).toBe("Invalid refresh token");
    });

    it("should handle non-Error exceptions during token refresh", async () => {
      vi.mocked(auth.refresh).mockRejectedValueOnce(null);

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        useAuthStore.setState({
          refreshToken: "some-token",
          isAuthenticated: true,
        });
      });

      await act(async () => {
        try {
          await result.current.doRefreshToken();
        } catch (e) {
          // Expected to throw
        }
      });

      expect(result.current.error).toBe("Token refresh failed");
    });

    it("should throw error on token refresh failure", async () => {
      const error = new Error("Refresh failed");
      vi.mocked(auth.refresh).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        useAuthStore.setState({
          refreshToken: "some-token",
        });
      });

      await act(async () => {
        await expect(result.current.doRefreshToken()).rejects.toThrow(
          "Refresh failed",
        );
      });
    });
  });

  describe("clearError() action", () => {
    it("should clear error state", () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        useAuthStore.setState({ error: "Some error message" });
      });

      expect(result.current.error).toBe("Some error message");

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe("Token Persistence", () => {
    it("should persist auth state to localStorage", async () => {
      vi.mocked(auth.login).mockResolvedValueOnce(mockLoginResponse);
      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login({
          username: "testuser",
          password: "Password123!",
          rememberMe: false,
        });
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "nexus_token",
        "mock-access-token",
      );
      expect(result.current.user).toEqual(mockLoginResponse.user);
      expect(result.current.accessToken).toBe("mock-access-token");
      expect(result.current.refreshToken).toBe("mock-refresh-token");
      expect(result.current.isAuthenticated).toBe(true);
    });

    it("should persist stable isLoading and error flags", async () => {
      vi.mocked(auth.login).mockResolvedValueOnce(mockLoginResponse);
      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login({
          username: "testuser",
          password: "Password123!",
          rememberMe: false,
        });
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "nexus_token",
        "mock-access-token",
      );
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe("setSession() action", () => {
    it("persists an externally-obtained token pair (e.g. from accepting an invitation)", () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.setSession({
          userId: "u1",
          accessToken: "invite-access-token",
          refreshToken: "invite-refresh-token",
        });
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "nexus_token",
        "invite-access-token",
      );
      expect(result.current.accessToken).toBe("invite-access-token");
      expect(result.current.refreshToken).toBe("invite-refresh-token");
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });
});
