import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CodeChangeProposalPayload } from "@nexus/core";
import { ImprovementCodeChangeDetail } from "./ImprovementCodeChangeDetail";

const payload: CodeChangeProposalPayload = {
  title: "Fix NUL-byte handling in outbox insert",
  description: "NUL bytes abort the outbox INSERT and wedge the run.",
  suspectedArea: ["apps/api/src/domain-events"],
  evidence: {
    runIds: ["eac4e46e-0000-4000-8000-000000000001"],
    failureClasses: ["outbox_insert_failed"],
    ledgerRefs: ["ledger:123"],
  },
  severity: "high",
};

describe("ImprovementCodeChangeDetail", () => {
  it("renders the brief with severity and evidence", () => {
    render(
      <ImprovementCodeChangeDetail payload={payload} occurrenceCount={3} />,
    );

    expect(
      screen.getByText("Fix NUL-byte handling in outbox insert"),
    ).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("seen 3×")).toBeInTheDocument();
    expect(
      screen.getByText("eac4e46e-0000-4000-8000-000000000001"),
    ).toBeInTheDocument();
    expect(screen.getByText("outbox_insert_failed")).toBeInTheDocument();
    expect(screen.getByText("apps/api/src/domain-events")).toBeInTheDocument();
  });

  it("hides the occurrence badge for first occurrences and omits absent sections", () => {
    const { suspectedArea: _omitted, ...rest } = payload;
    render(<ImprovementCodeChangeDetail payload={rest} occurrenceCount={1} />);

    expect(screen.queryByText(/seen/)).not.toBeInTheDocument();
    expect(screen.queryByText("Suspected area")).not.toBeInTheDocument();
  });

  it("hides the evidence section when all evidence arrays are empty", () => {
    const emptyEvidencePayload: CodeChangeProposalPayload = {
      ...payload,
      evidence: { runIds: [], failureClasses: [], ledgerRefs: [] },
    };
    render(
      <ImprovementCodeChangeDetail
        payload={emptyEvidencePayload}
        occurrenceCount={1}
      />,
    );

    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
  });

  it("shows the evidence section when at least one evidence array has entries", () => {
    const partialEvidencePayload: CodeChangeProposalPayload = {
      ...payload,
      evidence: {
        runIds: [],
        failureClasses: ["outbox_insert_failed"],
        ledgerRefs: [],
      },
    };
    render(
      <ImprovementCodeChangeDetail
        payload={partialEvidencePayload}
        occurrenceCount={1}
      />,
    );

    expect(screen.getByText("Evidence")).toBeInTheDocument();
    expect(screen.getByText("outbox_insert_failed")).toBeInTheDocument();
  });
});
