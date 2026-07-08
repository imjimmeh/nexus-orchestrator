import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NullableSelect } from "./nullable-select";
import { SelectItem } from "./select";

describe("NullableSelect", () => {
  it("shows placeholder when value is null", () => {
    render(
      <NullableSelect
        value={null}
        onValueChange={vi.fn()}
        placeholder="Pick one"
      >
        <SelectItem value="a">Option A</SelectItem>
      </NullableSelect>,
    );
    expect(screen.getByText("Pick one")).toBeTruthy();
  });

  it("shows the selected value when non-null", () => {
    render(
      <NullableSelect value="a" onValueChange={vi.fn()} placeholder="Pick one">
        <SelectItem value="a">Option A</SelectItem>
      </NullableSelect>,
    );
    expect(screen.getByText("Option A")).toBeTruthy();
  });

  it("calls onValueChange with null when the placeholder option is selected", () => {
    const onChange = vi.fn();
    render(
      <NullableSelect
        value="a"
        onValueChange={onChange}
        placeholder="No selection"
      >
        <SelectItem value="a">Option A</SelectItem>
      </NullableSelect>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "No selection" }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).not.toHaveBeenCalledWith("__none__");
  });

  it("calls onValueChange with string value when a real option is selected", () => {
    const onChange = vi.fn();
    render(
      <NullableSelect
        value={null}
        onValueChange={onChange}
        placeholder="No selection"
      >
        <SelectItem value="a">Option A</SelectItem>
      </NullableSelect>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Option A" }));
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("is disabled when disabled prop is set", () => {
    render(
      <NullableSelect
        value={null}
        onValueChange={vi.fn()}
        placeholder="Pick"
        disabled
      >
        <SelectItem value="a">A</SelectItem>
      </NullableSelect>,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
