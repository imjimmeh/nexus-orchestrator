import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DecisionMetadataSection } from "./WorkItemDetailSections";

describe("DecisionMetadataSection", () => {
  it("renders feedback needed badge and decision prompt when metadata indicates feedback is required", () => {
    render(
      <DecisionMetadataSection
        metadata={{
          feedbackNeeded: true,
          decisionPrompt: "Should this existing behavior be preserved?",
          humanDecisionPolicy: "ask_when_uncertain",
        }}
      />,
    );

    expect(screen.getByText("Feedback needed")).toBeTruthy();
    expect(
      screen.getByText("Should this existing behavior be preserved?"),
    ).toBeTruthy();
  });

  it("renders autonomous decision badge and rationale when metadata indicates an autonomous resolution", () => {
    render(
      <DecisionMetadataSection
        metadata={{
          autonomousDecision: true,
          resolutionRationale:
            "Autonomous mode converted this finding into actionable work.",
          humanDecisionPolicy: "decide_without_approval",
        }}
      />,
    );

    expect(screen.getByText("Autonomous decision")).toBeTruthy();
    expect(
      screen.getByText(
        "Autonomous mode converted this finding into actionable work.",
      ),
    ).toBeTruthy();
  });

  it("renders generated recommendation and status-preserved notice when a user override is present", () => {
    render(
      <DecisionMetadataSection
        metadata={{
          userStatusOverride: true,
          generatedRecommendation: "blocked",
          currentDisposition: "todo",
          lastGeneratedStatus: "blocked",
        }}
      />,
    );

    expect(screen.getByText("Generated recommendation: blocked")).toBeTruthy();
    expect(screen.getByText("Your current status is preserved")).toBeTruthy();
  });

  it("renders nothing when metadata is null", () => {
    const { container } = render(<DecisionMetadataSection metadata={null} />);

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when metadata has no decision fields", () => {
    const { container } = render(
      <DecisionMetadataSection metadata={{ sourceId: "abc" }} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("collects a feedback response for feedback-needed metadata and invokes callback with trimmed text", () => {
    const onResolveFeedback = vi.fn();

    render(
      <DecisionMetadataSection
        metadata={{
          feedbackNeeded: true,
          decisionPrompt: "Choose migration strategy",
          humanDecisionPolicy: "ask_when_uncertain",
        }}
        onResolveFeedback={onResolveFeedback}
      />,
    );

    fireEvent.change(screen.getByLabelText("Resolution"), {
      target: { value: "  Proceed with the staged migration plan.  " },
    });

    const button = screen.getByRole("button", {
      name: "Submit Feedback and Continue",
    });
    fireEvent.click(button);

    expect(onResolveFeedback).toHaveBeenCalledWith(
      "Proceed with the staged migration plan.",
    );
  });

  it("renders recorded human feedback details after resolution", () => {
    render(
      <DecisionMetadataSection
        metadata={{
          humanDecisionResponse: "Proceed with the staged migration plan.",
          humanDecisionResolvedBy: "architect-1",
          humanDecisionResolvedAt: "2026-05-19T18:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("Human feedback recorded")).toBeTruthy();
    expect(
      screen.getByText("Proceed with the staged migration plan."),
    ).toBeTruthy();
    expect(screen.getByText(/architect-1/)).toBeTruthy();
  });
});
