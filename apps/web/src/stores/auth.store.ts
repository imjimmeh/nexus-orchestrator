import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  UserResponse,
  RegisterRequest,
  RegisterResponse,
  LoginRequest,
  LoginResponse,
  RefreshTokenResponse,
} from "@nexus/core";
import { auth } from "../lib/api/auth";

interface AuthState {
  user: UserResponse | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface ExternalSession {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

interface AuthActions {
  register: (data: RegisterRequest) => Promise<void>;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  doRefreshToken: () => Promise<void>;
  clearError: () => void;
  validateAuth: () => Promise<boolean>;
  setSession: (session: ExternalSession) => void;
}

interface AuthStore extends AuthState, AuthActions {}

type AuthStoreSetter = (partial: Partial<AuthStore>) => void;
type AuthStoreGetter = () => AuthStore;

const ACCESS_TOKEN_STORAGE_KEY = "nexus_token";

const INITIAL_AUTH_STATE: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
};

function setStoredAccessToken(token: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (token) {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    return;
  }

  localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
}

function setAuthenticatedState(
  set: AuthStoreSetter,
  response: {
    user: UserResponse;
    accessToken: string;
    refreshToken: string;
  },
): void {
  setStoredAccessToken(response.accessToken);
  set({
    user: response.user,
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
}

function resetAuthState(
  set: AuthStoreSetter,
  error: string | null = null,
): void {
  setStoredAccessToken(null);
  set({
    user: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
    isLoading: false,
    error,
  });
}

async function registerAction(
  set: AuthStoreSetter,
  data: RegisterRequest,
): Promise<void> {
  set({ isLoading: true, error: null });
  try {
    const response: RegisterResponse = await auth.register(data);
    setAuthenticatedState(
      set,
      response as RegisterResponse & { user: UserResponse },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Registration failed";
    resetAuthState(set, message);
    throw err;
  }
}

async function loginAction(
  set: AuthStoreSetter,
  data: LoginRequest,
): Promise<void> {
  set({ isLoading: true, error: null });
  try {
    const response: LoginResponse = await auth.login(data);
    setAuthenticatedState(
      set,
      response as LoginResponse & { user: UserResponse },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Login failed";
    resetAuthState(set, message);
    throw err;
  }
}

async function logoutAction(
  set: AuthStoreSetter,
  refreshToken: string | null,
): Promise<void> {
  set({ isLoading: true });
  try {
    await auth.logout(refreshToken || undefined);
  } finally {
    resetAuthState(set);
  }
}

async function logoutAllAction(set: AuthStoreSetter): Promise<void> {
  set({ isLoading: true });
  try {
    await auth.logoutAll();
  } finally {
    resetAuthState(set);
  }
}

async function refreshTokenAction(
  set: AuthStoreSetter,
  get: AuthStoreGetter,
): Promise<void> {
  const currentRefreshToken = get().refreshToken;
  if (!currentRefreshToken) {
    resetAuthState(set, "No refresh token available");
    return;
  }

  try {
    const response: RefreshTokenResponse =
      await auth.refresh(currentRefreshToken);
    setStoredAccessToken(response.accessToken);
    set({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      isAuthenticated: true,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token refresh failed";
    resetAuthState(set, message);
    throw err;
  }
}

// Persists a token pair obtained outside the normal login/register flow (e.g.
// accepting an invitation, which returns a full session but no user profile).
// The user profile is intentionally left as-is here rather than synthesized
// from `userId` alone — a partial UserResponse would crash role checks
// (e.g. `user.roles.includes(...)`) elsewhere in the app. Callers that need
// the profile immediately should follow up with `validateAuth()`.
function setSessionAction(
  set: AuthStoreSetter,
  session: ExternalSession,
): void {
  setStoredAccessToken(session.accessToken);
  set({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
}

async function validateAuthAction(
  set: AuthStoreSetter,
  get: AuthStoreGetter,
): Promise<boolean> {
  const currentAccessToken = get().accessToken;
  if (!currentAccessToken) {
    resetAuthState(set);
    return false;
  }

  try {
    const response = await auth.getMe();
    set({
      user: response as UserResponse,
      isAuthenticated: true,
    });
    return true;
  } catch {
    resetAuthState(set, "Authentication expired");
    return false;
  }
}

function createAuthActions(
  set: AuthStoreSetter,
  get: AuthStoreGetter,
): AuthActions {
  return {
    register: async (data: RegisterRequest): Promise<void> =>
      registerAction(set, data),
    login: async (data: LoginRequest): Promise<void> => loginAction(set, data),
    logout: async (): Promise<void> => logoutAction(set, get().refreshToken),
    logoutAll: async (): Promise<void> => logoutAllAction(set),
    doRefreshToken: async (): Promise<void> => refreshTokenAction(set, get),
    clearError: (): void => {
      set({ error: null });
    },
    validateAuth: async (): Promise<boolean> => validateAuthAction(set, get),
    setSession: (session: ExternalSession): void =>
      setSessionAction(set, session),
  };
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_AUTH_STATE,
      ...createAuthActions(set, get),
    }),
    {
      name: "nexus-auth-storage",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken && typeof window !== "undefined") {
          localStorage.setItem("nexus_token", state.accessToken);
        }
      },
    },
  ),
);
