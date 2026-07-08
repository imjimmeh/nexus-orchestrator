import { describe, expect, it } from "vitest";
import { extractProposalId } from "./kanban-core-lifecycle-dead-letter.repository.helpers";

describe("extractProposalId", () => {
  it("extracts the proposalId from a stored dead-letter payload's envelope", () => {
    const envelope = JSON.stringify({
      event_id: "evt-1",
      event_type: "improvement.task.requested.v1",
      payload: { proposalId: "prop-123" },
    });

    expect(extractProposalId({ envelope })).toBe("prop-123");
  });

  it("returns null when the payload is null", () => {
    expect(extractProposalId(null)).toBeNull();
  });

  it("returns null when the envelope field is missing", () => {
    expect(extractProposalId({ event_id: "evt-1" })).toBeNull();
  });

  it("returns null when the envelope field is not a string", () => {
    expect(extractProposalId({ envelope: { not: "a string" } })).toBeNull();
  });

  it("returns null when the envelope is malformed JSON", () => {
    expect(extractProposalId({ envelope: "{not json" })).toBeNull();
  });

  it("returns null when the parsed envelope has no payload.proposalId", () => {
    const envelope = JSON.stringify({ payload: {} });
    expect(extractProposalId({ envelope })).toBeNull();
  });

  it("returns null when payload.proposalId is not a string", () => {
    const envelope = JSON.stringify({ payload: { proposalId: 12345 } });
    expect(extractProposalId({ envelope })).toBeNull();
  });
});
