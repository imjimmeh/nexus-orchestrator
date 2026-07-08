// apps/web/src/hooks/useAcceptInvitation.spec.tsx
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAcceptInvitation } from "./useAcceptInvitation";
import { api } from "@/lib/api/client";
import type { AcceptInvitationResult } from "@/lib/api/client.invitations.types";

vi.mock("@/lib/api/client", () => ({
  api: {
    acceptInvitation: vi.fn(),
  },
}));

const mockResult: AcceptInvitationResult = {
  userId: "u1",
  accessToken: "access-token",
  refreshToken: "refresh-token",
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useAcceptInvitation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls api.acceptInvitation with the dto and returns the result", async () => {
    vi.mocked(api.acceptInvitation).mockResolvedValue(mockResult);
    const { result } = renderHook(() => useAcceptInvitation(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      const data = await result.current.mutateAsync({ token: "tok-1" });
      expect(data).toEqual(mockResult);
    });

    expect(api.acceptInvitation).toHaveBeenCalledWith({ token: "tok-1" });
  });
});
