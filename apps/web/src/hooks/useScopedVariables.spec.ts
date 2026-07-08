import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useScopedVariables,
  useEffectiveVariables,
} from "./useScopedVariables";

vi.mock("@/lib/api/client.variables", () => ({
  listVariables: vi.fn(),
  getEffectiveVariables: vi.fn(),
  upsertVariable: vi.fn(),
  deleteVariable: vi.fn(),
}));

import {
  listVariables,
  getEffectiveVariables,
} from "@/lib/api/client.variables";

const mockListVariables = listVariables as ReturnType<typeof vi.fn>;
const mockGetEffectiveVariables = getEffectiveVariables as ReturnType<
  typeof vi.fn
>;

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useScopedVariables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches when scopeId is null (global scope)", async () => {
    mockListVariables.mockResolvedValue([]);
    const { result } = renderHook(() => useScopedVariables(null), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockListVariables).toHaveBeenCalledWith(null);
  });

  it("fetches when scopeId is a string", async () => {
    mockListVariables.mockResolvedValue([{ id: "1", key: "k", value: "v" }]);
    const { result } = renderHook(() => useScopedVariables("proj-123"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockListVariables).toHaveBeenCalledWith("proj-123");
  });

  it("does NOT fetch when scopeId is undefined (caller not ready)", () => {
    const { result } = renderHook(
      () => useScopedVariables(undefined as unknown as null),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockListVariables).not.toHaveBeenCalled();
  });
});

describe("useEffectiveVariables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches when scopeId is null (global scope)", async () => {
    mockGetEffectiveVariables.mockResolvedValue([]);
    const { result } = renderHook(() => useEffectiveVariables(null), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetEffectiveVariables).toHaveBeenCalledWith(null);
  });

  it("does NOT fetch when scopeId is undefined", () => {
    const { result } = renderHook(
      () => useEffectiveVariables(undefined as unknown as null),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockGetEffectiveVariables).not.toHaveBeenCalled();
  });
});
