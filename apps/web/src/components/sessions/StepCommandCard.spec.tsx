import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepCommandCard } from "./StepCommandCard";

describe("StepCommandCard", () => {
  it("renders the command, output, and a running status", () => {
    render(
      <StepCommandCard
        model={{
          stepId: "run_gate",
          command: "npm test",
          output: "PASS\n",
          status: "running",
          exitCode: null,
        }}
      />,
    );
    expect(screen.getByText(/npm test/)).toBeInTheDocument();
    expect(screen.getByText(/PASS/)).toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it("shows a non-zero exit code when the command failed", () => {
    render(
      <StepCommandCard
        model={{
          stepId: "run_gate",
          command: "npm test",
          output: "boom",
          status: "exited",
          exitCode: 2,
        }}
      />,
    );
    expect(screen.getByText(/exit 2/i)).toBeInTheDocument();
  });
});
