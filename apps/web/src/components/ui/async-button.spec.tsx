import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AsyncButton } from "./async-button";

describe("AsyncButton", () => {
  it("renders children when not loading", () => {
    render(<AsyncButton isLoading={false}>Save</AsyncButton>);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("disables the button while loading", () => {
    render(<AsyncButton isLoading={true}>Save</AsyncButton>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("renders a Loader2 spinner while loading", () => {
    render(<AsyncButton isLoading={true}>Save</AsyncButton>);
    const button = screen.getByRole("button");
    expect(button.querySelector("svg")).toBeTruthy();
  });

  it("renders a custom loading icon when provided", () => {
    render(
      <AsyncButton
        isLoading={true}
        loadingIcon={<span data-testid="custom-icon" />}
      >
        Save
      </AsyncButton>,
    );
    expect(screen.getByTestId("custom-icon")).toBeTruthy();
  });

  it("forwards variant and size props to Button", () => {
    render(
      <AsyncButton isLoading={false} variant="outline" size="sm">
        Cancel
      </AsyncButton>,
    );
    const btn = screen.getByRole("button", { name: "Cancel" });
    expect(btn.className).toContain("border");
  });

  it("respects disabled prop independently of isLoading", () => {
    render(
      <AsyncButton isLoading={false} disabled>
        Save
      </AsyncButton>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
