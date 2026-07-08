import { describe, expect, it } from "vitest";
import { NullExternalTicketProvider } from "./null-external-ticket.provider.js";

describe("NullExternalTicketProvider", () => {
  const provider = new NullExternalTicketProvider();

  describe("providerType", () => {
    it('returns "null"', () => {
      expect(provider.providerType).toBe("null");
    });
  });

  describe("capabilities", () => {
    it("declares no capabilities", () => {
      expect(provider.capabilities).toEqual({
        supportsCreate: false,
        supportsUpdate: false,
        supportsDelete: false,
        supportsWebhooks: false,
        supportsPolling: false,
        supportsComments: false,
        supportsAttachments: false,
      });
    });
  });

  describe("validateConfig", () => {
    it("accepts plain object configs", () => {
      expect(provider.validateConfig({})).toBe(true);
      expect(provider.validateConfig({ apiKey: "test" })).toBe(true);
    });

    it("rejects null config", () => {
      expect(provider.validateConfig(null)).toBe(false);
    });

    it("rejects undefined config", () => {
      expect(provider.validateConfig(undefined)).toBe(false);
    });

    it("rejects non-object configs", () => {
      expect(provider.validateConfig("string")).toBe(false);
      expect(provider.validateConfig(42)).toBe(false);
      expect(provider.validateConfig(true)).toBe(false);
    });
  });

  describe("fetchTickets", () => {
    it("returns empty paginated result", async () => {
      const result = await provider.fetchTickets();

      expect(result).toEqual({ items: [], hasMore: false });
    });
  });

  describe("fetchTicket", () => {
    it("returns null for any external id", async () => {
      const result = await provider.fetchTicket("any-id");

      expect(result).toBeNull();
    });
  });

  describe("createTicket", () => {
    it("returns a ticket with a generated id", async () => {
      const result = await provider.createTicket({ title: "Test Ticket" });

      expect(result.id).toMatch(/^null-/);
      expect(result.title).toBe("Test Ticket");
    });

    it("uses id as fallback title", async () => {
      const result = await provider.createTicket({});

      expect(result.id).toMatch(/^null-/);
      expect(result.title).toBe(result.id);
    });

    it("does not allow input id to override the generated id", async () => {
      const result = await provider.createTicket({
        id: "injected-id",
        title: "Test",
      });

      expect(result.id).toMatch(/^null-/);
      expect(result.id).not.toBe("injected-id");
      expect(result.title).toBe("Test");
    });
  });

  describe("updateTicket", () => {
    it("returns the updated ticket with the same external id", async () => {
      const result = await provider.updateTicket("ext-1", {
        title: "Updated Title",
      });

      expect(result.id).toBe("ext-1");
      expect(result.title).toBe("Updated Title");
    });

    it("does not allow data.id to override the externalId parameter", async () => {
      const result = await provider.updateTicket("ext-original", {
        id: "ext-evil",
        title: "Updated",
      });

      expect(result.id).toBe("ext-original");
      expect(result.title).toBe("Updated");
    });
  });

  describe("deleteTicket", () => {
    it("resolves without error for any external id", async () => {
      await expect(provider.deleteTicket("any-id")).resolves.toBeUndefined();
    });
  });

  describe("validateWebhookSignature", () => {
    it("returns true for any payload and signature", () => {
      expect(provider.validateWebhookSignature({}, "abc123")).toBe(true);
      expect(provider.validateWebhookSignature({ data: 1 }, "")).toBe(true);
    });
  });

  describe("parseWebhookEvents", () => {
    it("returns an empty event list for any payload", () => {
      expect(provider.parseWebhookEvents({})).toEqual([]);
      expect(provider.parseWebhookEvents({ events: [] })).toEqual([]);
    });
  });
});
