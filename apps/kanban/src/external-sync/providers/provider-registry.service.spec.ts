import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { IExternalTicketProvider } from "./external-ticket-provider.types.js";
import { ProviderRegistryService } from "./provider-registry.service.js";

function buildMockProvider(
  overrides: Partial<IExternalTicketProvider> = {},
): IExternalTicketProvider {
  return {
    providerType: "mock",
    capabilities: {
      supportsCreate: false,
      supportsUpdate: false,
      supportsDelete: false,
      supportsWebhooks: false,
      supportsPolling: false,
      supportsComments: false,
      supportsAttachments: false,
    },
    validateConfig: () => true,
    fetchTickets: () => Promise.resolve({ items: [], hasMore: false }),
    fetchTicket: () => Promise.resolve(null),
    createTicket: () => Promise.resolve({ id: "mock-1", title: "mock" }),
    updateTicket: () => Promise.resolve({ id: "mock-1", title: "updated" }),
    deleteTicket: () => Promise.resolve(),
    validateWebhookSignature: () => true,
    parseWebhookEvents: () => [],
    ...overrides,
  };
}

describe("ProviderRegistryService", () => {
  it("resolves the matching provider by providerType", () => {
    const providerA = buildMockProvider({ providerType: "linear" });
    const providerB = buildMockProvider({ providerType: "jira" });
    const registry = new ProviderRegistryService([providerA, providerB]);

    const resolved = registry.resolve("jira");

    expect(resolved).toBe(providerB);
  });

  it("rejects duplicate providerType values at construction", () => {
    const providerA = buildMockProvider({ providerType: "linear" });
    const providerB = buildMockProvider({ providerType: "linear" });

    expect(() => new ProviderRegistryService([providerA, providerB])).toThrow(
      ConflictException,
    );
  });

  it("rejects unknown provider types during resolution", () => {
    const registry = new ProviderRegistryService([]);

    expect(() => registry.resolve("unknown")).toThrow(NotFoundException);
  });
});
