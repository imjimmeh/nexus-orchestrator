import { useCallback } from "react";
import { useAuthStore } from "@/stores/auth.store";
import type { UseAuthReturn } from "./useAuth.types";

export type { UseAuthReturn } from "./useAuth.types";

export function useAuth(): UseAuthReturn {
  const store = useAuthStore();
  const hasHydrated = useAuthStore.persist.hasHydrated();

  const login = useCallback(
    async (email: string, password: string, rememberMe: boolean = false) => {
      await store.login({ username: email, password, rememberMe });
    },
    [store],
  );

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      await store.register({ username, email, password });
    },
    [store],
  );

  const logout = useCallback(async () => {
    await store.logout();
  }, [store]);

  const logoutAll = useCallback(async () => {
    await store.logoutAll();
  }, [store]);

  const refreshToken = useCallback(async () => {
    await store.doRefreshToken();
  }, [store]);

  const clearError = useCallback(() => {
    store.clearError();
  }, [store]);

  const validateAuth = useCallback(async () => {
    return store.validateAuth();
  }, [store]);

  const hasRole = useCallback(
    (role: string): boolean => {
      return store.user?.roles.includes(role as "admin" | "user") ?? false;
    },
    [store.user],
  );

  const isAdmin = useCallback((): boolean => {
    return hasRole("admin");
  }, [hasRole]);

  return {
    // State
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    isLoading: store.isLoading,
    error: store.error,
    hasHydrated,

    // Actions
    login,
    register,
    logout,
    logoutAll,
    refreshToken,
    clearError,
    validateAuth,

    // Helper methods
    hasRole,
    isAdmin,
  };
}
