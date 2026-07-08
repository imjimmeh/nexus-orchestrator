import type { ApiClient } from "./client";

export const notificationApiMethods = {
  async getNotificationsInbox(
    this: ApiClient,
    params?: { limit?: number; offset?: number; read?: "true" | "false" },
  ): Promise<{
    success: boolean;
    data: Array<{
      id: string;
      userId: string;
      projectId: string | null;
      channel: string;
      externalRecipientId: string;
      subject: string;
      body: string;
      status: string;
      eventType: string;
      correlationId: string | null;
      metadata: Record<string, unknown> | null;
      createdAt: string;
      updatedAt: string;
      sentAt: string | null;
      failedAt: string | null;
      errorMessage: string | null;
      readAt: string | null;
      readByUserId: string | null;
    }>;
    meta: { total: number; limit: number; offset: number };
  }> {
    const query = new URLSearchParams();
    if (typeof params?.limit === "number") {
      query.set("limit", String(params.limit));
    }
    if (typeof params?.offset === "number") {
      query.set("offset", String(params.offset));
    }
    if (typeof params?.read === "string") {
      query.set("read", params.read);
    }

    const endpoint =
      query.toString().length > 0
        ? `/notifications/inbox?${query.toString()}`
        : "/notifications/inbox";

    const response = await this.client.get(endpoint);
    return response.data;
  },

  async getUnreadNotificationCount(this: ApiClient): Promise<{
    success: boolean;
    data: { count: number };
  }> {
    const response = await this.client.get("/notifications/inbox/unread-count");
    return response.data;
  },

  async markNotificationRead(
    this: ApiClient,
    id: string,
  ): Promise<{
    success: boolean;
    data: {
      id: string;
      readAt: string | null;
      readByUserId: string | null;
    } | null;
  }> {
    const response = await this.client.post(
      `/notifications/inbox/${encodeURIComponent(id)}/read`,
    );
    return response.data;
  },

  async markAllNotificationsRead(this: ApiClient): Promise<{
    success: boolean;
    data: { markedAsRead: number };
  }> {
    const response = await this.client.post(
      "/notifications/inbox/read-all",
      {},
    );
    return response.data;
  },

  async getNotificationsWebsocketConfig(this: ApiClient): Promise<{
    wsUrl: string;
    namespace: string;
  }> {
    return this.get<{ wsUrl: string; namespace: string }>(
      "/notifications/inbox/websocket-config",
    );
  },
};
