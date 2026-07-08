import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HarnessContributionsField } from "./AgentProfileForm.fields";

describe("HarnessContributionsField", () => {
  it("renders a contributions editor with the section label", () => {
    render(<HarnessContributionsField value={null} onChange={() => {}} />);
    expect(screen.getByText(/Harness Contributions/i)).toBeInTheDocument();
  });
});
