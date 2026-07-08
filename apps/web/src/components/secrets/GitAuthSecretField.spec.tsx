import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitAuthSecretField } from "./GitAuthSecretField";
import type { SecretOption } from "./secret-option.types";

const secrets: SecretOption[] = [
  { id: "secret-1", name: "GH PAT" },
  { id: "secret-2", name: "SSH Key" },
];

describe("GitAuthSecretField", () => {
  it("renders the none option and secret options, and selects the current value", () => {
    render(
      <GitAuthSecretField
        id="secret-field"
        value="secret-1"
        secrets={secrets}
        secretsError={false}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: "GH PAT" })).toBeTruthy();
    expect(screen.getByText(/SSH Key/)).toBeTruthy();
    expect(screen.getByText("No secret selected")).toBeTruthy();
  });

  it("emits null when the none option is selected", () => {
    const onChange = vi.fn();
    render(
      <GitAuthSecretField
        id="secret-field"
        value="secret-1"
        secrets={secrets}
        secretsError={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("No secret selected"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("emits the secret id when an option is selected", () => {
    const onChange = vi.fn();
    render(
      <GitAuthSecretField
        id="secret-field"
        value={null}
        secrets={secrets}
        secretsError={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("SSH Key"));
    expect(onChange).toHaveBeenCalledWith("secret-2");
  });

  it("hides the Manage Secrets button when onManageSecrets is omitted", () => {
    render(
      <GitAuthSecretField
        id="secret-field"
        value={null}
        secrets={secrets}
        secretsError={false}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /manage secrets/i }),
    ).toBeNull();
  });

  it("renders the Manage Secrets button when onManageSecrets is provided", () => {
    render(
      <GitAuthSecretField
        id="secret-field"
        value={null}
        secrets={secrets}
        secretsError={false}
        onChange={vi.fn()}
        onManageSecrets={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /manage secrets/i }),
    ).toBeTruthy();
  });

  it("renders the error message when secretsError is true", () => {
    render(
      <GitAuthSecretField
        id="secret-field"
        value={null}
        secrets={[]}
        secretsError
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Failed to load secrets/i)).toBeTruthy();
  });

  it("renders custom label and help text", () => {
    render(
      <GitAuthSecretField
        id="secret-field"
        value={null}
        secrets={[]}
        secretsError={false}
        onChange={vi.fn()}
        label="Git Auth Secret (optional)"
        helpText="Private repos need a secret."
      />,
    );
    expect(screen.getByText("Git Auth Secret (optional)")).toBeTruthy();
    expect(screen.getByText("Private repos need a secret.")).toBeTruthy();
  });

  it("associates the label with the combobox when id is omitted", () => {
    render(
      <GitAuthSecretField
        value={null}
        secrets={[]}
        secretsError={false}
        onChange={vi.fn()}
      />,
    );
    const label = screen.getByText("Git Auth Secret").closest("label");
    const combobox = screen.getByRole("combobox");
    expect(label).not.toBeNull();
    expect(label?.htmlFor).toBe(combobox.id);
    expect(combobox.id).not.toBe("");
  });

  it("marks the combobox invalid and describes the error when secretsError is true", () => {
    render(
      <GitAuthSecretField
        id="secret-field"
        value={null}
        secrets={[]}
        secretsError
        onChange={vi.fn()}
      />,
    );
    const combobox = screen.getByRole("combobox");
    expect(combobox.getAttribute("aria-invalid")).toBe("true");
    expect(combobox.getAttribute("aria-describedby")).toContain(
      "secret-field-error",
    );
  });
});
