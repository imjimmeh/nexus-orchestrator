import { beforeEach, describe, expect, it, vi } from "vitest";
import type { api as apiClientSingleton } from "./client";

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

describe("ApiClient budget methods", () => {
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

  it("preserves usage rows and total count from the response envelope", async () => {
    const usageEvent = {
      id: "usage-1",
      correlation_id: "run-1",
      scope_id: null,
      context_type: "workflow_run" as const,
      context_id: "run-1",
      actor_type: "agent" as const,
      actor_id: null,
      provider_name: "minimax",
      model_name: "MiniMax-M3",
      input_tokens: null,
      output_tokens: null,
      total_tokens: 57_856,
      estimated_cost_cents: 1,
      estimate_source: "model_rate" as const,
      metadata: null,
      created_at: "2026-06-04T20:12:13.810Z",
    };

    mockAxiosClient.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          data: [usageEvent],
          total: 12,
        },
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.fetchUsageEvents({ limit: 50, offset: 0 });

    expect(mockAxiosClient.get).toHaveBeenCalledWith("/cost-governance/usage", {
      params: { limit: 50, offset: 0 },
    });
    expect(result).toEqual({ data: [usageEvent], total: 12 });
  }, 15_000);
});
