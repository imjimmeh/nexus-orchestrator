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

describe("ApiClient createSkillAssignmentProposal", () => {
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

  it("posts the body to /improvement/proposals and preserves the outcome + proposal", async () => {
    const proposal = {
      id: "proposal-1",
      kind: "skill_assignment" as const,
      status: "applied" as const,
      payload: { skillName: "some-skill" },
      evidence: {},
      confidence: 1,
      occurrence_count: 1,
      provenance: { source: "ui_operator" },
      created_at: "2026-07-04T00:00:00Z",
      updated_at: "2026-07-04T00:00:00Z",
    };

    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        outcome: "auto_applied",
        data: proposal,
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const body = {
      skillName: "some-skill",
      targets: [{ type: "agent_profile" as const, profileName: "merge-agent" }],
      rationale: "operator requested",
    };

    const result = await apiClient.createSkillAssignmentProposal(body);

    expect(mockAxiosClient.post).toHaveBeenCalledWith(
      "/improvement/proposals",
      body,
    );
    expect(result).toEqual({ outcome: "auto_applied", proposal });
  });

  it("preserves a dropped outcome with a null proposal", async () => {
    mockAxiosClient.post.mockResolvedValueOnce({
      data: {
        success: true,
        outcome: "dropped",
        data: null,
      },
    });

    const { ApiClient } = await import("./client");
    const apiClient = new ApiClient() as ApiClientTestClient;

    const result = await apiClient.createSkillAssignmentProposal({
      skillName: "some-skill",
      targets: [{ type: "workflow_step" as const, workflowName: "ceo-cycle" }],
    });

    expect(result).toEqual({ outcome: "dropped", proposal: null });
  });
});
