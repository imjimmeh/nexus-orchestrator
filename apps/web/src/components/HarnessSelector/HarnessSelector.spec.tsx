import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { HarnessSelector } from "./HarnessSelector";

const HARNESSES = [
  { harnessId: "pi", displayName: "PI" },
  { harnessId: "claude-code", displayName: "Claude Code" },
];

describe("HarnessSelector", () => {
  it("renders available harnesses", () => {
    render(
      <HarnessSelector
        harnesses={HARNESSES}
        value="claude-code"
        onChange={() => {}}
      />,
    );

    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("includes inherit option when allowInherit is true", () => {
    render(
      <HarnessSelector
        harnesses={HARNESSES}
        value={undefined}
        onChange={() => {}}
        allowInherit
      />,
    );

    expect(screen.getByText(/inherit/i)).toBeInTheDocument();
  });

  it("renders label text", () => {
    render(
      <HarnessSelector
        harnesses={HARNESSES}
        value="pi"
        onChange={() => {}}
        label="Execution Harness"
      />,
    );

    expect(screen.getByText("Execution Harness")).toBeInTheDocument();
  });

  it("renders default label when none provided", () => {
    render(
      <HarnessSelector harnesses={HARNESSES} value="pi" onChange={() => {}} />,
    );

    expect(screen.getByText("Harness")).toBeInTheDocument();
  });
});
