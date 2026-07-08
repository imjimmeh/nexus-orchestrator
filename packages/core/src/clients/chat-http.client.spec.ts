import { ChatHttpClient } from "./chat-http.client";

describe("ChatHttpClient", () => {
  it("publishes chat events to the internal chat endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(undefined, { status: 204 }));

    const client = new ChatHttpClient({
      baseUrl: "http://localhost:3010",
      fetchImpl: fetchMock,
    });

    await client.publishChatEvent({
      eventId: "chat-event-1",
      eventType: "chat.message.sent.v1",
      eventVersion: "v1",
      occurredAt: "2026-04-14T00:00:00.000Z",
      correlationId: "corr-1",
      sourceService: "chat",
      payload: {
        chat_session_id: "chat-session-1",
        messageId: "message-1",
        direction: "outbound",
        channel: "web",
        text: "hello",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3010/internal/chat/events",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
