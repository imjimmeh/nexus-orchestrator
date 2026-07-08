import { beforeEach, describe, expect, it, vi } from "vitest";
import type { api as apiClientSingleton } from "./client";
import type { EffectiveMember } from "./client.scope.types";

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

describe("ApiClient scope member methods", () => {
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

  it("getScopeMembers fetches effective members for a scope node", async () => {
    const member: EffectiveMember = {
      userId: "user-1",
      userEmail: "user-1@example.com",
      roleId: "role-1",
      roleName: "Admin",
      source: "direct",
      sourceScopeNodeId: "scope-1",
      sourceScopeName: "Org",
    };

    mockAxiosClient.get.mockResolvedValueOnce({
      data: { success: true, data: [member] },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getScopeMembers("scope-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/scopes/scope-1/members",
      undefined,
    );
    expect(result).toEqual([member]);
  }, 10_000);

  it("revokeMemberRole deletes a role assignment by userId and roleId body", async () => {
    mockAxiosClient.delete.mockResolvedValueOnce({ data: undefined });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await apiClient.revokeMemberRole("scope-1", {
      userId: "user-1",
      roleId: "role-1",
    });

    expect(mockAxiosClient.delete).toHaveBeenCalledWith(
      "/scopes/scope-1/role-assignments",
      { data: { userId: "user-1", roleId: "role-1" } },
    );
  });

  it("updateScopeNode PATCHes /scopes/:id with name/isTenantRoot and returns the updated node", async () => {
    const updated = {
      id: "scope-1",
      parentId: null,
      type: "org" as const,
      name: "Renamed Org",
      slug: "renamed-org",
      metadata: {},
      isTenantRoot: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    mockAxiosClient.patch.mockResolvedValueOnce({
      data: { success: true, data: updated },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.updateScopeNode("scope-1", {
      name: "Renamed Org",
      isTenantRoot: true,
    });

    expect(mockAxiosClient.patch).toHaveBeenCalledWith("/scopes/scope-1", {
      name: "Renamed Org",
      isTenantRoot: true,
    });
    expect(result).toEqual(updated);
  });

  it("moveScopeNode PATCHes /scopes/:id/move with newParentId", async () => {
    mockAxiosClient.patch.mockResolvedValueOnce({
      data: { success: true, data: null },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await apiClient.moveScopeNode("scope-1", { newParentId: "scope-parent" });

    expect(mockAxiosClient.patch).toHaveBeenCalledWith("/scopes/scope-1/move", {
      newParentId: "scope-parent",
    });
  });

  it("archiveScopeNode POSTs /scopes/:id/archive", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: { success: true, data: null },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    await apiClient.archiveScopeNode("scope-1");

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/scopes/scope-1/archive",
      undefined,
    );
  });

  it("getAllowedChildTypes GETs /scopes/:id/allowed-child-types and returns the type list", async () => {
    mockAxiosClient.get.mockResolvedValueOnce({
      data: { success: true, data: ["team", "project"] },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.getAllowedChildTypes("scope-1");

    expect(mockAxiosClient.get).toHaveBeenCalledWith(
      "/scopes/scope-1/allowed-child-types",
      undefined,
    );
    expect(result).toEqual(["team", "project"]);
  });
});
