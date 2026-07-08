import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { HarnessRunIndicator } from "./HarnessRunIndicator";

describe("HarnessRunIndicator", () => {
  it("shows resolved harness and fallback badge when present", () => {
    render(
      <HarnessRunIndicator
        resolved="pi"
        fallback={{ from: "claude-code", reason: "branching" }}
      />,
    );

    expect(screen.getByText(/pi/i)).toBeInTheDocument();
    expect(screen.getByText(/fallback/i)).toBeInTheDocument();
  });

  it("shows no fallback badge when no fallback", () => {
    render(<HarnessRunIndicator resolved="pi" />);

    expect(screen.queryByText(/fallback/i)).not.toBeInTheDocument();
  });

  it("renders the resolved harness name", () => {
    render(<HarnessRunIndicator resolved="claude-code" />);

    expect(screen.getByText("claude-code")).toBeInTheDocument();
  });
});
