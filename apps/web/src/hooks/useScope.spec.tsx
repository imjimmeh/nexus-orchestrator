// apps/web/src/hooks/useScope.spec.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useScopeTree,
  useScopeNode,
  useCreateScopeNode,
  useUpdateScopeNode,
  useMoveScopeNode,
  useArchiveScopeNode,
  useAllowedChildTypes,
} from "./useScope";
import { api } from "@/lib/api/client";
import type { ScopeNode } from "@/lib/api/client.scope.types";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";

vi.mock("@/lib/api/client", () => ({
  api: {
    getScopeTree: vi.fn(),
    getScopeNode: vi.fn(),
    createScopeNode: vi.fn(),
    updateScopeNode: vi.fn(),
    moveScopeNode: vi.fn(),
    archiveScopeNode: vi.fn(),
    getAllowedChildTypes: vi.fn(),
  },
}));

const mockRoot: ScopeNode = {
  id: GLOBAL_SCOPE_NODE_ID,
  parentId: null,
  type: "platform",
  name: "Platform",
  slug: "platform",
  metadata: {},
  createdAt: "",
  updatedAt: "",
  children: [],
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
}

describe("useScopeTree", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns tree data from api", async () => {
    vi.mocked(api.getScopeTree).mockResolvedValue(mockRoot);
    const { result } = renderHook(() => useScopeTree(), {
      wrapper: makeWrapper().wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockRoot);
  });
});

describe("useScopeNode", () => {
  it("fetches a single node by id", async () => {
    vi.mocked(api.getScopeNode).mockResolvedValue(mockRoot);
    const { result } = renderHook(() => useScopeNode(GLOBAL_SCOPE_NODE_ID), {
      wrapper: makeWrapper().wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getScopeNode).toHaveBeenCalledWith(GLOBAL_SCOPE_NODE_ID);
  });

  it("does not fetch when id is empty", () => {
    const { result } = renderHook(() => useScopeNode(""), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCreateScopeNode", () => {
  it("is exported and is a function", () => {
    expect(typeof useCreateScopeNode).toBe("function");
  });

  it("invalidates the scope tree query on success", async () => {
    vi.mocked(api.createScopeNode).mockResolvedValue(mockRoot);
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useCreateScopeNode(), { wrapper });

    await result.current.mutateAsync({
      parentId: GLOBAL_SCOPE_NODE_ID,
      type: "team",
      name: "Backend",
    });

    expect(api.createScopeNode).toHaveBeenCalledWith({
      parentId: GLOBAL_SCOPE_NODE_ID,
      type: "team",
      name: "Backend",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["scope", "tree"],
    });
  });
});

describe("useUpdateScopeNode", () => {
  it("calls api.updateScopeNode with the bound id and invalidates tree + node", async () => {
    vi.mocked(api.updateScopeNode).mockResolvedValue(mockRoot);
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useUpdateScopeNode("n1"), { wrapper });

    await result.current.mutateAsync({ name: "X" });

    expect(api.updateScopeNode).toHaveBeenCalledWith("n1", { name: "X" });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["scope", "tree"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["scope", "node", "n1"],
    });
  });
});

describe("useMoveScopeNode", () => {
  it("calls api.moveScopeNode and invalidates the scope tree", async () => {
    vi.mocked(api.moveScopeNode).mockResolvedValue(undefined);
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useMoveScopeNode(), { wrapper });

    await result.current.mutateAsync({ id: "n1", newParentId: "n2" });

    expect(api.moveScopeNode).toHaveBeenCalledWith("n1", { newParentId: "n2" });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["scope", "tree"],
    });
  });
});

describe("useArchiveScopeNode", () => {
  it("calls api.archiveScopeNode and invalidates the scope tree", async () => {
    vi.mocked(api.archiveScopeNode).mockResolvedValue(undefined);
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useArchiveScopeNode(), { wrapper });

    await result.current.mutateAsync("n1");

    expect(api.archiveScopeNode).toHaveBeenCalledWith("n1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["scope", "tree"],
    });
  });
});

describe("useAllowedChildTypes", () => {
  it("resolves the allowed child types for a scope node", async () => {
    vi.mocked(api.getAllowedChildTypes).mockResolvedValue(["team", "project"]);
    const { result } = renderHook(() => useAllowedChildTypes("n1"), {
      wrapper: makeWrapper().wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getAllowedChildTypes).toHaveBeenCalledWith("n1");
    expect(result.current.data).toEqual(["team", "project"]);
  });

  it("does not fetch when scopeNodeId is empty", () => {
    const { result } = renderHook(() => useAllowedChildTypes(""), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
