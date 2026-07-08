import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import type { ApiResponse } from "./common.types";
import type { RefreshTokenResponse } from "./auth.types";

interface QueueItem {
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface PersistedAuthStorage {
  state?: {
    accessToken?: string | null;
    refreshToken?: string | null;
  };
}

const AUTH_STORAGE_KEY = "nexus-auth-storage";
const ACCESS_TOKEN_KEY = "nexus_token";

function getPersistedAuthStorage(): PersistedAuthStorage | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as PersistedAuthStorage;
  } catch {
    return null;
  }
}

function isNonEmptyToken(token: string | null | undefined): token is string {
  return Boolean(token && token !== "undefined" && token !== "null");
}

export function getAccessToken(): string | null {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (isNonEmptyToken(token)) {
    return token;
  }

  const persistedToken = getPersistedAuthStorage()?.state?.accessToken;
  return isNonEmptyToken(persistedToken) ? persistedToken : null;
}

export function getRefreshToken(): string | null {
  const persistedToken = getPersistedAuthStorage()?.state?.refreshToken;
  return isNonEmptyToken(persistedToken) ? persistedToken : null;
}

export function setAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function setPersistedTokens(
  accessToken: string,
  refreshToken: string,
): void {
  const persisted = getPersistedAuthStorage();
  if (!persisted?.state) {
    return;
  }

  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      ...persisted,
      state: {
        ...persisted.state,
        accessToken,
        refreshToken,
      },
    }),
  );
}

export function clearAuthTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function processQueue(queue: QueueItem[], error: Error | null): void {
  queue.forEach((pending) => {
    if (error) {
      pending.reject(error);
      return;
    }

    pending.resolve();
  });
}

export function configureApiClientAuth(
  client: AxiosInstance,
  getBaseUrl: (requestPath?: string) => string,
): void {
  let isRefreshing = false;
  let failedQueue: QueueItem[] = [];

  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const requestPath =
        typeof config.url === "string" ? config.url : undefined;
      config.baseURL = getBaseUrl(requestPath);

      if (typeof window !== "undefined") {
        const token = getAccessToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }

      return config;
    },
    (error) => Promise.reject(error),
  );

  client.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & {
        _retry?: boolean;
      };

      if (
        error.response?.status !== 401 ||
        !originalRequest ||
        originalRequest._retry
      ) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(() => client(originalRequest))
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = getRefreshToken();
        if (!refreshToken) {
          throw new Error("No refresh token available");
        }

        const response = await axios.post<ApiResponse<RefreshTokenResponse>>(
          `${getBaseUrl("/auth/refresh")}/auth/refresh`,
          { refreshToken },
        );

        const { accessToken, refreshToken: newRefreshToken } =
          response.data.data;
        setAccessToken(accessToken);
        setPersistedTokens(accessToken, newRefreshToken);

        processQueue(failedQueue, null);
        failedQueue = [];
        isRefreshing = false;

        return client(originalRequest);
      } catch (refreshError) {
        processQueue(failedQueue, refreshError as Error);
        failedQueue = [];
        isRefreshing = false;

        if (typeof window !== "undefined") {
          clearAuthTokens();
          window.location.href = "/login";
        }

        return Promise.reject(refreshError);
      }
    },
  );
}
