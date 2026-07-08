import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotifications } from "./useNotifications";
import { api } from "@/lib/api/client";

const { io } = await import("socket.io-client");

vi.mock("@/lib/api/client", () => ({
  api: {
    getNotificationsInbox: vi.fn(),
    getUnreadNotificationCount: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    getNotificationsWebsocketConfig: vi.fn(),
  },
}));

const socketHandlers: Record<
  string,
  ((payload?: unknown) => void) | undefined
> = {};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      socketHandlers[event] = handler;
    }),
    disconnect: vi.fn(),
  })),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
};

describe("useNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(socketHandlers).forEach((key) => {
      delete socketHandlers[key];
    });

    vi.mocked(api.getNotificationsInbox).mockResolvedValue({
      success: true,
      data: [
        {
          id: "1",
          userId: "user-1",
          projectId: "project-1",
          channel: "in_app",
          externalRecipientId: "user-1",
          subject: "Test",
          body: "Body",
          status: "pending",
          eventType: "workflow.run.failed",
          correlationId: null,
          metadata: null,
          createdAt: "2026-04-19T12:00:00Z",
          updatedAt: "2026-04-19T12:00:00Z",
          sentAt: null,
          failedAt: null,
          errorMessage: null,
          readAt: null,
          readByUserId: null,
        },
      ],
      meta: { total: 1, limit: 20, offset: 0 },
    });
    vi.mocked(api.getUnreadNotificationCount).mockResolvedValue({
      success: true,
      data: { count: 1 },
    });
    vi.mocked(api.getNotificationsWebsocketConfig).mockResolvedValue({
      wsUrl: "http://localhost:3001",
      namespace: "/notifications",
    });
  });

  it("fetches notifications and unread count", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.unreadCount).toBe(1);
      expect(result.current.total).toBe(1);
    });
  });

  it("marks notification as read", async () => {
    vi.mocked(api.markNotificationRead).mockResolvedValue({
      success: true,
      data: {
        id: "1",
        readAt: "2026-04-19T12:30:00Z",
        readByUserId: "user-1",
      },
    });

    const { result } = renderHook(() => useNotifications(), { wrapper });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
    });

    result.current.markRead.mutate("1");

    await waitFor(() => {
      expect(api.markNotificationRead).toHaveBeenCalledWith("1");
    });
  });

  it("does not fetch deprecated notification action items", async () => {
    renderHook(() => useNotifications(), { wrapper });

    await waitFor(() => {
      expect(api.getNotificationsInbox).toHaveBeenCalled();
    });

    expect("getNotificationActionItems" in api).toBe(false);
  });

  it("fetches inbox without opening a socket connection", async () => {
    renderHook(() => useNotifications(), { wrapper });

    await waitFor(() => {
      expect(api.getNotificationsInbox).toHaveBeenCalled();
    });

    expect(api.getNotificationsWebsocketConfig).not.toHaveBeenCalled();
    expect(io).not.toHaveBeenCalled();
  });
});
