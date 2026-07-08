import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ALL_FILTER_VALUE,
  ImprovementProposalFilterBar,
} from "./ImprovementProposalFilterBar";

describe("ImprovementProposalFilterBar", () => {
  it("reflects a programmatic filter reset in the kind Select's displayed value", () => {
    const { rerender } = render(
      <ImprovementProposalFilterBar
        kindValue="code_change"
        statusValue={ALL_FILTER_VALUE}
        onKindChange={vi.fn()}
        onStatusChange={vi.fn()}
        selectedCount={0}
        onBulkApprove={vi.fn()}
        onBulkReject={vi.fn()}
      />,
    );

    expect(screen.getByText("code_change")).toBeInTheDocument();

    rerender(
      <ImprovementProposalFilterBar
        kindValue={ALL_FILTER_VALUE}
        statusValue={ALL_FILTER_VALUE}
        onKindChange={vi.fn()}
        onStatusChange={vi.fn()}
        selectedCount={0}
        onBulkApprove={vi.fn()}
        onBulkReject={vi.fn()}
      />,
    );

    expect(screen.queryByText("code_change")).not.toBeInTheDocument();
    expect(screen.getAllByText("All kinds").length).toBeGreaterThan(0);
  });
});
