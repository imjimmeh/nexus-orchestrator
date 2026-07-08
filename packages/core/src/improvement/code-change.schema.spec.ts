import { describe, expect, it } from "vitest";
import {
  CodeChangeProposalPayloadSchema,
  CodeChangeSeveritySchema,
} from "./code-change.schema";

const validPayload = {
  title: "Fix NUL-byte handling in outbox insert",
  description:
    "Runs fail terminally when docker log tails containing NUL bytes reach the outbox INSERT.",
  suspectedArea: ["apps/api/src/domain-events"],
  evidence: {
    runIds: ["eac4e46e-0000-4000-8000-000000000001"],
    failureClasses: ["outbox_insert_failed"],
    ledgerRefs: ["ledger:123"],
  },
  severity: "high",
};

describe("CodeChangeProposalPayloadSchema", () => {
  it("parses a fully-populated brief", () => {
    expect(CodeChangeProposalPayloadSchema.parse(validPayload)).toEqual(
      validPayload,
    );
  });

  it("parses without the optional suspectedArea", () => {
    const { suspectedArea: _omitted, ...rest } = validPayload;
    expect(CodeChangeProposalPayloadSchema.parse(rest)).toEqual(rest);
  });

  it("rejects a missing title", () => {
    const { title: _omitted, ...rest } = validPayload;
    expect(() => CodeChangeProposalPayloadSchema.parse(rest)).toThrow();
  });

  it("rejects an unknown severity", () => {
    expect(() =>
      CodeChangeProposalPayloadSchema.parse({
        ...validPayload,
        severity: "urgent",
      }),
    ).toThrow();
  });

  it("rejects unknown keys (strict)", () => {
    expect(() =>
      CodeChangeProposalPayloadSchema.parse({
        ...validPayload,
        unexpectedField: "nope",
      }),
    ).toThrow();
  });

  it("exposes the severity enum for UI filters", () => {
    expect(CodeChangeSeveritySchema.options).toEqual([
      "low",
      "medium",
      "high",
      "critical",
    ]);
  });
});
