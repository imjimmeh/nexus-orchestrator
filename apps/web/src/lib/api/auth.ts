import {
  RegisterRequest,
  RegisterResponse,
  LoginRequest,
  LoginResponse,
  RefreshTokenResponse,
  UserResponse,
} from "@nexus/core";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { resolveRuntimeConfig } from "../config";
import type { ResolvedRuntimeConfig } from "../config";

export class AuthClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.client.interceptors.request.use(
      (config) => {
        if (typeof window !== "undefined") {
          const runtimeConfig = (
            window as Window & { __RUNTIME_CONFIG__?: ResolvedRuntimeConfig }
          ).__RUNTIME_CONFIG__;
          config.baseURL = resolveRuntimeConfig(runtimeConfig).coreApiUrl;

          const token = localStorage.getItem("nexus_token");
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }

          return config;
        }

        config.baseURL = resolveRuntimeConfig(undefined).coreApiUrl;
        return config;
      },
      (error) => Promise.reject(error),
    );
  }

  private async post<T>(url: string, data?: unknown): Promise<T> {
    const response: AxiosResponse<{ data: T }> = await this.client.post(
      url,
      data,
    );
    return response.data.data;
  }

  private async get<T>(url: string): Promise<T> {
    const response: AxiosResponse<{ data: T }> = await this.client.get(url);
    return response.data.data;
  }

  async register(data: RegisterRequest): Promise<RegisterResponse> {
    return this.post<RegisterResponse>("/auth/register", data);
  }

  async login(data: LoginRequest): Promise<LoginResponse> {
    return this.post<LoginResponse>("/auth/login", data);
  }

  async refresh(refreshToken: string): Promise<RefreshTokenResponse> {
    return this.post<RefreshTokenResponse>("/auth/refresh", { refreshToken });
  }

  async logout(refreshToken?: string): Promise<void> {
    await this.post<void>(
      "/auth/logout",
      refreshToken ? { refreshToken } : undefined,
    );
  }

  async logoutAll(): Promise<void> {
    await this.post<void>("/auth/logout-all");
  }

  async getMe(): Promise<UserResponse> {
    return this.get<UserResponse>("/auth/me");
  }
}

export const auth = new AuthClient();
