import { describe, expect, it } from "vitest";
import {
  ImprovementTaskRequestedEventEnvelopeV1Schema,
  InterServiceEventEnvelopeV1Schema,
} from "./event-envelope.schema";

const validEnvelope = {
  event_id: "0f0e0d0c-0000-4000-8000-000000000001",
  event_type: "improvement.task.requested.v1",
  event_version: "v1",
  occurred_at: "2026-07-02T12:00:00.000Z",
  correlation_id: "11111111-0000-4000-8000-000000000002",
  source_service: "core",
  payload: {
    proposalId: "11111111-0000-4000-8000-000000000002",
    title: "Fix NUL-byte handling in outbox insert",
    description: "Runs fail terminally when NUL bytes reach the outbox INSERT.",
    suspectedArea: ["apps/api/src/domain-events"],
    evidence: {
      runIds: ["eac4e46e-0000-4000-8000-000000000001"],
      failureClasses: ["outbox_insert_failed"],
      ledgerRefs: ["ledger:123"],
    },
    severity: "high",
    occurrenceCount: 3,
  },
};

describe("ImprovementTaskRequestedEventEnvelopeV1Schema", () => {
  it("parses a valid envelope", () => {
    expect(
      ImprovementTaskRequestedEventEnvelopeV1Schema.parse(validEnvelope),
    ).toEqual(validEnvelope);
  });

  it("is a member of the inter-service envelope union", () => {
    expect(InterServiceEventEnvelopeV1Schema.parse(validEnvelope)).toEqual(
      validEnvelope,
    );
  });

  it("rejects a non-core source service", () => {
    expect(() =>
      ImprovementTaskRequestedEventEnvelopeV1Schema.parse({
        ...validEnvelope,
        source_service: "chat",
      }),
    ).toThrow();
  });

  it("rejects a zero occurrenceCount", () => {
    expect(() =>
      ImprovementTaskRequestedEventEnvelopeV1Schema.parse({
        ...validEnvelope,
        payload: { ...validEnvelope.payload, occurrenceCount: 0 },
      }),
    ).toThrow();
  });

  it("rejects unknown payload keys (strict)", () => {
    expect(() =>
      ImprovementTaskRequestedEventEnvelopeV1Schema.parse({
        ...validEnvelope,
        payload: { ...validEnvelope.payload, boardColumn: "todo" },
      }),
    ).toThrow();
  });
});
