import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useApplyGitOpsBinding,
  useCreateGitOpsBinding,
  useGitOpsBindings,
  useOutboundSyncGitOpsBinding,
  usePlanGitOpsBinding,
} from "./useGitOps";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type { GitOpsRepositoryBinding } from "@/lib/api/client.gitops.types";

vi.mock("@/lib/api/client", () => ({
  api: {
    getGitOpsBindings: vi.fn(),
    createGitOpsBinding: vi.fn(),
    planGitOpsBinding: vi.fn(),
    applyGitOpsBinding: vi.fn(),
    syncGitOpsBindingOutbound: vi.fn(),
  },
}));

const binding: GitOpsRepositoryBinding = {
  id: "binding-1",
  scopeNodeId: "scope-1",
  name: "platform-config",
  repoUrl: "https://example.com/repo.git",
  defaultRef: "main",
  rootPath: ".",
  syncMode: "two_way",
  credentialsSecretId: null,
  enabled: true,
  includedObjectTypes: ["workflow"],
  conflictPolicy: "require_review",
  lastAppliedRevision: "rev-1",
  createdByUserId: "user-1",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
};

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useGitOps bindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists bindings for a scope", async () => {
    vi.mocked(api.getGitOpsBindings).mockResolvedValue([binding]);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useGitOpsBindings("scope-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getGitOpsBindings).toHaveBeenCalledWith("scope-1");
    expect(result.current.data).toEqual([binding]);
  });

  it("creates a binding with a sync mode and invalidates status", async () => {
    vi.mocked(api.createGitOpsBinding).mockResolvedValue(binding);
    const { queryClient, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateGitOpsBinding(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        scopeNodeId: "scope-1",
        name: "platform-config",
        repoUrl: "https://example.com/repo.git",
        defaultRef: "main",
        rootPath: ".",
        syncMode: "two_way",
        includedObjectTypes: ["workflow"],
      });
    });

    expect(api.createGitOpsBinding).toHaveBeenCalledWith(
      expect.objectContaining({ syncMode: "two_way" }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.gitops.status(),
    });
  });

  it("runs plan and apply for a binding", async () => {
    vi.mocked(api.planGitOpsBinding).mockResolvedValue({ changes: [] });
    vi.mocked(api.applyGitOpsBinding).mockResolvedValue({ applied: 1 });
    const { wrapper } = makeWrapper();

    const planHook = renderHook(() => usePlanGitOpsBinding(), { wrapper });
    const applyHook = renderHook(() => useApplyGitOpsBinding(), { wrapper });

    await act(async () => {
      await planHook.result.current.mutateAsync({
        scopeNodeId: "scope-1",
        bindingId: "binding-1",
      });
      await applyHook.result.current.mutateAsync({
        scopeNodeId: "scope-1",
        bindingId: "binding-1",
      });
    });

    expect(api.planGitOpsBinding).toHaveBeenCalledWith("scope-1", "binding-1");
    expect(api.applyGitOpsBinding).toHaveBeenCalledWith("scope-1", "binding-1");
  });

  it("runs outbound sync for a binding and invalidates status", async () => {
    vi.mocked(api.syncGitOpsBindingOutbound).mockResolvedValue({
      bindingId: "binding-1",
      branchName: "gitops/binding-1/1",
      pendingChangeCount: 1,
    });
    const { queryClient, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useOutboundSyncGitOpsBinding(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        scopeNodeId: "scope-1",
        bindingId: "binding-1",
      });
    });

    expect(api.syncGitOpsBindingOutbound).toHaveBeenCalledWith(
      "scope-1",
      "binding-1",
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.gitops.status(),
    });
  });
});
