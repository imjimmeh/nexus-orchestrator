import type { UserResponse } from "@nexus/core";

export interface UseAuthReturn {
  // State
  user: UserResponse | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  hasHydrated: boolean;

  // Actions
  login: (
    email: string,
    password: string,
    rememberMe?: boolean,
  ) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshToken: () => Promise<void>;
  clearError: () => void;
  validateAuth: () => Promise<boolean>;

  // Helper methods
  hasRole: (role: string) => boolean;
  isAdmin: () => boolean;
}
