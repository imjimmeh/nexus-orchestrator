import {
  ChatCreateSessionResponseV1Schema,
  ChatGetSessionResponseV1Schema,
} from "./chat-service-contracts.schema";

describe("chat-service contracts", () => {
  it("parses create-session success envelope", () => {
    const parsed = ChatCreateSessionResponseV1Schema.parse({
      success: true,
      data: {
        id: "chat-123",
      },
    });

    expect(parsed.data.id).toBe("chat-123");
  });

  it("rejects session details response without message timeline", () => {
    expect(() =>
      ChatGetSessionResponseV1Schema.parse({
        success: true,
        data: {
          id: "chat-123",
          status: "RUNNING",
          agentProfileName: "ceo-agent",
          scope_id: null,
          displayLabel: null,
          displayName: "Chat with CEO",
          initialMessage: "hello",
          createdAt: "2026-04-13T00:00:00.000Z",
          completedAt: null,
          model: null,
          provider: null,
          containerTier: 1,
          errorMessage: null,
        },
      }),
    ).toThrow();
  });
});
