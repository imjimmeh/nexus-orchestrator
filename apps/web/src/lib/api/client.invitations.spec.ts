import { beforeEach, describe, expect, it, vi } from "vitest";
import type { api as apiClientSingleton } from "./client";
import type { Invitation } from "./client.invitations.types";

type ApiClientTestClient = typeof apiClientSingleton;

type StorageMap = Record<string, string>;

const mockAxiosClient = {
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
};

vi.mock("axios", () => ({
  __esModule: true,
  default: {
    create: vi.fn(() => mockAxiosClient),
    post: vi.fn(),
  },
}));

function createLocalStorage(storage: StorageMap) {
  return {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      Reflect.deleteProperty(storage, key);
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(storage)) {
        Reflect.deleteProperty(storage, key);
      }
    }),
  };
}

describe("ApiClient invitation methods", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    const localStorageMock = createLocalStorage({});

    Object.defineProperty(globalThis, "window", {
      value: {
        __RUNTIME_CONFIG__: undefined,
        localStorage: localStorageMock,
        location: { href: "/" },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      configurable: true,
      writable: true,
    });
  });

  it("createInvitation posts to /scopes/:scopeNodeId/invitations and returns invitation + inviteToken", async () => {
    const invitation: Invitation = {
      id: "invitation-1",
      scopeNodeId: "scope-1",
      roleId: "role-1",
      email: "invitee@example.com",
      status: "pending",
      expiresAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
    };

    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: { invitation, inviteToken: "raw-token-value" },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.createInvitation("scope-1", {
      roleId: "role-1",
      email: "invitee@example.com",
    });

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/scopes/scope-1/invitations",
      { roleId: "role-1", email: "invitee@example.com" },
    );
    expect(result).toEqual({ invitation, inviteToken: "raw-token-value" });
  });

  it("getInvitations fetches pending invitations for a scope node", async () => {
    const invitation: Invitation = {
      id: "invitation-1",
      scopeNodeId: "scope-1",
      roleId: "role-1",
      email: null,
      status: "pending",
      expiresAt: "2026-08-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
    };

    mockAxiosClient.get.mockResolvedValueOnce({
      data: { success: true, data: [invitation] },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getInvitations("scope-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/scopes/scope-1/invitations",
      undefined,
    );
    expect(result).toEqual([invitation]);
  });

  it("revokeInvitation deletes an invitation by id", async () => {
    mockAxiosClient.delete.mockResolvedValueOnce({ data: undefined });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await apiClient.revokeInvitation("invitation-1");

    expect(mockAxiosClient.delete).toHaveBeenCalledWith(
      "/invitations/invitation-1",
    );
  });

  it("acceptInvitation posts to /invitations/accept and returns userId + tokens", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          userId: "user-1",
          accessToken: "access-token-value",
          refreshToken: "refresh-token-value",
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.acceptInvitation({
      token: "raw-token-value",
      username: "newuser",
      password: "s3cret-password",
    });

    expect(mockAxiosClient.post).toHaveBeenCalledWith("/invitations/accept", {
      token: "raw-token-value",
      username: "newuser",
      password: "s3cret-password",
    });
    expect(result).toEqual({
      userId: "user-1",
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
    });
  });
});
