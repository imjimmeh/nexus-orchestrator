import { describe, expect, it } from "vitest";
import {
  CoreIntegrationPrStatusEventEnvelopeV1Schema,
  CoreIntegrationPrStatusPayloadV1Schema,
} from "./event-envelope.schema";

const validPayload = {
  scopeId: "scope-1",
  contextId: "context-1",
  prUrl: "https://github.com/acme/widgets/pull/42",
  checks: "failing",
  reviewDecision: "changes_requested",
};

describe("core.integration.pr_status.v1 schema", () => {
  it("accepts a neutral payload with scopeId/contextId/prUrl/checks/reviewDecision", () => {
    expect(
      CoreIntegrationPrStatusPayloadV1Schema.safeParse(validPayload).success,
    ).toBe(true);
  });

  it("accepts a full envelope with the pinned event_type and source_service core", () => {
    const envelope = {
      event_id: "11111111-1111-1111-1111-111111111111",
      event_type: "core.integration.pr_status.v1",
      event_version: "v1",
      occurred_at: "2026-06-22T00:00:00.000Z",
      correlation_id: "22222222-2222-2222-2222-222222222222",
      source_service: "core",
      payload: validPayload,
      metadata: null,
    };
    expect(
      CoreIntegrationPrStatusEventEnvelopeV1Schema.safeParse(envelope).success,
    ).toBe(true);
  });

  it("rejects an unknown checks value", () => {
    expect(
      CoreIntegrationPrStatusPayloadV1Schema.safeParse({
        ...validPayload,
        checks: "exploded",
      }).success,
    ).toBe(false);
  });

  it("rejects a payload missing reviewDecision", () => {
    const { reviewDecision, ...rest } = validPayload;
    expect(CoreIntegrationPrStatusPayloadV1Schema.safeParse(rest).success).toBe(
      false,
    );
  });
});
