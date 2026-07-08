import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderModelBadge } from "./ProviderModelBadge";

describe("ProviderModelBadge", () => {
  it("renders provider and model", () => {
    render(<ProviderModelBadge provider="anthropic" model="claude-opus-4-8" />);
    expect(screen.getByText(/anthropic/)).toBeInTheDocument();
    expect(screen.getByText(/claude-opus-4-8/)).toBeInTheDocument();
  });

  it("renders a fallback when model is missing", () => {
    render(<ProviderModelBadge provider={null} model={null} />);
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  });
});
