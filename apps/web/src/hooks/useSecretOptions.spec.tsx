import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSecretOptions } from "./useSecretOptions";

const apiMock = vi.hoisted(() => ({ getSecrets: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: apiMock }));

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useSecretOptions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps raw secrets to { id, name } options", async () => {
    apiMock.getSecrets.mockResolvedValue([
      {
        id: "secret-1",
        name: "GH PAT",
        metadata: {},
        created_at: "",
        updated_at: "",
      },
    ]);
    const { result } = renderHook(() => useSecretOptions(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.secrets).toHaveLength(1));
    expect(result.current.secrets[0]).toEqual({
      id: "secret-1",
      name: "GH PAT",
    });
    expect(result.current.isError).toBe(false);
  });

  it("surfaces isError when the secrets query fails", async () => {
    apiMock.getSecrets.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useSecretOptions(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.secrets).toEqual([]);
  });
});
