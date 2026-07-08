import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkItemCostEstimatePanel } from "./WorkItemCostEstimatePanel";
import * as hookModule from "@/hooks/useWorkItemCostEstimate";

describe("WorkItemCostEstimatePanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the point estimate, confidence note, and what-if list when available", () => {
    vi.spyOn(hookModule, "useWorkItemCostEstimate").mockReturnValue({
      data: {
        available: true,
        bucketTier: "workflow_type",
        sampleCount: 8,
        estimatedCostCents: 500,
        lowCostCents: 400,
        highCostCents: 600,
        whatIf: [],
        costCents: 125,
        predictedRemainingCostCents: 500,
        projectedTotalCostCents: 625,
        lowPredictedRemainingCostCents: 400,
        highPredictedRemainingCostCents: 600,
        lowProjectedTotalCostCents: 525,
        highProjectedTotalCostCents: 725,
        currentStage: {
          available: true,
          bucketTier: "workflow_type",
          sampleCount: 8,
          estimatedCostCents: 200,
          lowCostCents: 150,
          highCostCents: 250,
          whatIf: [],
        },
        fullyImplement: {
          available: true,
          bucketTier: "workflow_type",
          sampleCount: 8,
          estimatedCostCents: 500,
          lowCostCents: 400,
          highCostCents: 600,
          whatIf: [
            {
              modelId: "model-2",
              modelName: "gpt-5-mini",
              providerName: "openai",
              estimatedCostCents: 300,
            },
          ],
        },
      },
      isLoading: false,
    } as never);

    render(<WorkItemCostEstimatePanel projectId="proj-1" workItemId="wi-1" />);

    expect(screen.getByText("Actual So Far")).toBeTruthy();
    expect(screen.getByText("Predicted Remaining")).toBeTruthy();
    expect(screen.getByText("Projected Total")).toBeTruthy();
    expect(screen.getByText("$1.25")).toBeTruthy();
    expect(screen.getByText("$6.25")).toBeTruthy();
    expect(
      screen.getByText(/projected range: \$5\.25 - \$7\.25/i),
    ).toBeTruthy();
    expect(screen.getByText("Current Stage Cost")).toBeTruthy();
    expect(screen.getByText("$2.00")).toBeTruthy();
    expect(screen.getByText("Cost to Fully Implement")).toBeTruthy();
    expect(screen.getAllByText("$5.00").length).toBe(2);
    expect(screen.getAllByText(/based on 8/i).length).toBe(2);
    expect(screen.getByText("gpt-5-mini")).toBeTruthy();
    expect(screen.getByText("$3.00")).toBeTruthy();
  });

  it("shows an insufficient-data message when no estimate is available", () => {
    vi.spyOn(hookModule, "useWorkItemCostEstimate").mockReturnValue({
      data: {
        available: false,
        bucketTier: null,
        sampleCount: 0,
        estimatedCostCents: null,
        lowCostCents: null,
        highCostCents: null,
        whatIf: [],
      },
      isLoading: false,
    } as never);

    render(<WorkItemCostEstimatePanel projectId="proj-1" workItemId="wi-1" />);

    expect(screen.getAllByText(/not enough history/i).length).toBe(2);
  });

  it("does not show zero dollars when an available estimate lacks model pricing", () => {
    vi.spyOn(hookModule, "useWorkItemCostEstimate").mockReturnValue({
      data: {
        available: true,
        bucketTier: "global",
        sampleCount: 230,
        estimatedCostCents: null,
        lowCostCents: null,
        highCostCents: null,
        whatIf: [],
        currentStage: {
          available: true,
          bucketTier: "global",
          sampleCount: 230,
          estimatedCostCents: null,
          lowCostCents: null,
          highCostCents: null,
          whatIf: [],
        },
        fullyImplement: {
          available: false,
          bucketTier: null,
          sampleCount: 0,
          estimatedCostCents: null,
          lowCostCents: null,
          highCostCents: null,
          whatIf: [],
        },
      },
      isLoading: false,
    } as never);

    render(<WorkItemCostEstimatePanel projectId="proj-1" workItemId="wi-1" />);

    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getByText(/pricing unavailable/i)).toBeTruthy();
    expect(screen.getByText(/based on 230/i)).toBeTruthy();
  });
});
