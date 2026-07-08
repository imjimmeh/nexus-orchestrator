import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SwitchField } from "./SwitchField";

describe("SwitchField", () => {
  it("renders label and checkbox toggle", () => {
    render(<SwitchField label="Enabled" checked={false} onChange={() => {}} />);

    expect(screen.getByText("Enabled")).toBeTruthy();
    expect(screen.getByRole("checkbox")).toBeTruthy();
  });

  it("renders unchecked state", () => {
    render(<SwitchField label="Enabled" checked={false} onChange={() => {}} />);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("data-state")).toBe("unchecked");
  });

  it("renders checked state", () => {
    render(<SwitchField label="Enabled" checked={true} onChange={() => {}} />);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("data-state")).toBe("checked");
  });

  it("calls onChange with true when toggled from unchecked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SwitchField label="Enabled" checked={false} onChange={onChange} />);

    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange with false when toggled from checked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SwitchField label="Enabled" checked={true} onChange={onChange} />);

    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("renders description text", () => {
    render(
      <SwitchField
        label="Enabled"
        checked={false}
        onChange={() => {}}
        description="Toggle this to enable"
      />,
    );

    expect(screen.getByText("Toggle this to enable")).toBeTruthy();
  });

  it("does not render description when not provided", () => {
    const { container } = render(
      <SwitchField label="Enabled" checked={false} onChange={() => {}} />,
    );

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs.length).toBe(0);
  });
});
