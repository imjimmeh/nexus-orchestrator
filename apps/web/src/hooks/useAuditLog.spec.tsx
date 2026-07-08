// apps/web/src/hooks/useAuditLog.spec.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuditLog } from "./useAuditLog";
import { api } from "@/lib/api/client";
import type { AuditLogResponse } from "@/lib/api/client.audit.types";

vi.mock("@/lib/api/client", () => ({ api: { getAuditLog: vi.fn() } }));

const mockResponse: AuditLogResponse = {
  entries: [
    {
      id: "e1",
      eventType: "authz.role_granted",
      userId: "u1",
      userEmail: "alice@test.com",
      scopeNodeId: "scope-1",
      scopeNodeName: "Engineering",
      metadata: {},
      createdAt: "2026-06-09T14:00:00Z",
    },
  ],
  total: 1,
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useAuditLog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches audit log with filters", async () => {
    vi.mocked(api.getAuditLog).mockResolvedValue(mockResponse);
    const { result } = renderHook(
      () => useAuditLog({ scopeNodeId: "scope-1", limit: 20 }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getAuditLog).toHaveBeenCalledWith({
      scopeNodeId: "scope-1",
      limit: 20,
    });
    expect(result.current.data?.total).toBe(1);
  });
});
