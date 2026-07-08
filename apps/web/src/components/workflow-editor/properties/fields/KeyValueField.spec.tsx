import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { KeyValueField } from "./KeyValueField";

describe("KeyValueField", () => {
  it("renders label and empty state", () => {
    render(
      <KeyValueField label="Variables" entries={{}} onChange={() => {}} />,
    );

    expect(screen.getByText("Variables")).toBeTruthy();
    expect(screen.getByRole("button", { name: /add/i })).toBeTruthy();
  });

  it("renders existing key-value pairs", () => {
    render(
      <KeyValueField
        label="Variables"
        entries={{ FOO: "bar", BAZ: "qux" }}
        onChange={() => {}}
      />,
    );

    const keyInputs = screen.getAllByPlaceholderText("Key");
    const valueInputs = screen.getAllByPlaceholderText("Value");

    expect(keyInputs.length).toBe(2);
    expect(valueInputs.length).toBe(2);
    expect((keyInputs[0] as HTMLInputElement).value).toBe("FOO");
    expect((valueInputs[0] as HTMLInputElement).value).toBe("bar");
    expect((keyInputs[1] as HTMLInputElement).value).toBe("BAZ");
    expect((valueInputs[1] as HTMLInputElement).value).toBe("qux");
  });

  it("calls onChange when a key is changed", () => {
    const onChange = vi.fn();
    render(
      <KeyValueField
        label="Variables"
        entries={{ FOO: "bar" }}
        onChange={onChange}
      />,
    );

    const keyInput = screen.getByDisplayValue("FOO");
    fireEvent.change(keyInput, { target: { value: "NEW_KEY" } });

    expect(onChange).toHaveBeenCalledWith({ NEW_KEY: "bar" });
  });

  it("calls onChange when a value is changed", () => {
    const onChange = vi.fn();
    render(
      <KeyValueField
        label="Variables"
        entries={{ FOO: "bar" }}
        onChange={onChange}
      />,
    );

    const valueInput = screen.getByDisplayValue("bar");
    fireEvent.change(valueInput, { target: { value: "new_value" } });

    expect(onChange).toHaveBeenCalledWith({ FOO: "new_value" });
  });

  it("adds a new row when add button is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <KeyValueField label="Variables" entries={{}} onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(onChange).toHaveBeenCalledWith({ "": "" });
  });

  it("removes a row when remove button is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <KeyValueField
        label="Variables"
        entries={{ FOO: "bar", BAZ: "qux" }}
        onChange={onChange}
      />,
    );

    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    expect(removeButtons.length).toBe(2);

    await user.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledWith({ BAZ: "qux" });
  });

  it("renders custom key and value placeholders", () => {
    render(
      <KeyValueField
        label="Env"
        entries={{ DEFAULT: "" }}
        onChange={() => {}}
        keyPlaceholder="env_name"
        valuePlaceholder="env_value"
      />,
    );

    expect(screen.getByPlaceholderText("env_name")).toBeTruthy();
    expect(screen.getByPlaceholderText("env_value")).toBeTruthy();
  });

  it("renders description text", () => {
    render(
      <KeyValueField
        label="Variables"
        entries={{}}
        onChange={() => {}}
        description="Set environment variables"
      />,
    );

    expect(screen.getByText("Set environment variables")).toBeTruthy();
  });

  it("renders default placeholders when not specified", () => {
    render(
      <KeyValueField
        label="Variables"
        entries={{ DEFAULT: "" }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByPlaceholderText("Key")).toBeTruthy();
    expect(screen.getByPlaceholderText("Value")).toBeTruthy();
  });
});
