// apps/web/src/hooks/useUserSearch.spec.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useUserSearch } from "./useUserSearch";
import { usersApi } from "@/lib/api/users";
import type { UserListResponse } from "@nexus/core";

vi.mock("@/lib/api/users", () => ({
  usersApi: {
    getUsers: vi.fn(),
  },
}));

const mockUserListResponse: UserListResponse = {
  data: [
    {
      id: "u1",
      username: "alice",
      email: "alice@test.com",
      roles: ["user"],
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useUserSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("searches users and maps to id/username/email", async () => {
    vi.mocked(usersApi.getUsers).mockResolvedValue(mockUserListResponse);
    const { result } = renderHook(() => useUserSearch("alice"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(usersApi.getUsers).toHaveBeenCalledWith({
      search: "alice",
      limit: 10,
    });
    expect(result.current.data).toEqual([
      { id: "u1", username: "alice", email: "alice@test.com" },
    ]);
  });

  it("is disabled for a query shorter than the minimum length", () => {
    vi.mocked(usersApi.getUsers).mockResolvedValue(mockUserListResponse);
    const { result } = renderHook(() => useUserSearch("a"), {
      wrapper: makeWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(usersApi.getUsers).not.toHaveBeenCalled();
  });

  it("is disabled for an empty/whitespace query", () => {
    vi.mocked(usersApi.getUsers).mockResolvedValue(mockUserListResponse);
    const { result } = renderHook(() => useUserSearch("   "), {
      wrapper: makeWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(usersApi.getUsers).not.toHaveBeenCalled();
  });
});
