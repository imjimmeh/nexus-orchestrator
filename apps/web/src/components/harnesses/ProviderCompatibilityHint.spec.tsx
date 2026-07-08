import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderCompatibilityHint } from "./ProviderCompatibilityHint";

describe("ProviderCompatibilityHint", () => {
  it("renders nothing when the harness sets no compatibleProviderIds", () => {
    const { container } = render(
      <ProviderCompatibilityHint
        compatibleProviderIds={undefined}
        selectedProviderId="openai"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("lists the valid providers when a compatibility list is set", () => {
    render(
      <ProviderCompatibilityHint
        compatibleProviderIds={["anthropic"]}
        selectedProviderId={undefined}
      />,
    );

    expect(screen.getByText(/anthropic/i)).toBeInTheDocument();
  });

  it("flags an incompatible selected provider", () => {
    render(
      <ProviderCompatibilityHint
        compatibleProviderIds={["anthropic"]}
        selectedProviderId="openai"
      />,
    );

    expect(screen.getByText(/incompatible/i)).toBeInTheDocument();
  });

  it("does not flag a compatible selected provider", () => {
    render(
      <ProviderCompatibilityHint
        compatibleProviderIds={["anthropic"]}
        selectedProviderId="anthropic"
      />,
    );

    expect(screen.queryByText(/incompatible/i)).not.toBeInTheDocument();
  });
});
