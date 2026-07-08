import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SelectField } from "./SelectField";

const DEFAULT_OPTIONS = [
  { value: "gpt-4", label: "GPT-4" },
  { value: "gpt-3.5", label: "GPT-3.5" },
  { value: "claude-3", label: "Claude 3" },
];

function renderSelect(
  props: Partial<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    description: string;
  }> = {},
) {
  const defaultProps = {
    label: "Model",
    value: "gpt-4",
    onChange: vi.fn(),
    options: DEFAULT_OPTIONS,
    ...props,
  };
  return render(<SelectField {...defaultProps} />);
}

describe("SelectField", () => {
  it("renders label and select trigger", () => {
    renderSelect();

    expect(screen.getByText("Model")).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("renders the selected option label", () => {
    renderSelect({ value: "gpt-4" });

    expect(screen.getByText("GPT-4")).toBeTruthy();
  });

  it("calls onChange when a different option is selected", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderSelect({ value: "gpt-4", onChange });

    await user.click(screen.getByRole("combobox"));
    const option = screen.getByRole("option", { name: "GPT-3.5" });
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith("gpt-3.5");
  });

  it("renders all options in the dropdown", async () => {
    const user = userEvent.setup();
    renderSelect();

    await user.click(screen.getByRole("combobox"));

    expect(screen.getByRole("option", { name: "GPT-4" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "GPT-3.5" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Claude 3" })).toBeTruthy();
  });

  it("renders description text", () => {
    renderSelect({ description: "Choose a model" });

    expect(screen.getByText("Choose a model")).toBeTruthy();
  });

  it("selects the correct option when value changes", () => {
    const { rerender } = renderSelect({ value: "gpt-4" });

    expect(screen.getByText("GPT-4")).toBeTruthy();

    rerender(
      <SelectField
        label="Model"
        value="claude-3"
        onChange={vi.fn()}
        options={DEFAULT_OPTIONS}
      />,
    );

    expect(screen.getByText("Claude 3")).toBeTruthy();
  });
});
