import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterCheckbox } from "./filter-checkbox";

describe("FilterCheckbox", () => {
  it("renders the label text", () => {
    render(
      <FilterCheckbox
        checked={false}
        onCheckedChange={vi.fn()}
        label="Show errors"
      />,
    );
    expect(screen.getByText("Show errors")).toBeTruthy();
  });

  it("renders checked state", () => {
    render(
      <FilterCheckbox
        checked={true}
        onCheckedChange={vi.fn()}
        label="Show errors"
      />,
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("calls onCheckedChange with boolean true when checked", () => {
    const onChange = vi.fn();
    render(
      <FilterCheckbox
        checked={false}
        onCheckedChange={onChange}
        label="Show errors"
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("calls onCheckedChange with false when unchecked", () => {
    const onChange = vi.fn();
    render(
      <FilterCheckbox
        checked={true}
        onCheckedChange={onChange}
        label="Show errors"
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("sets aria-label from label prop", () => {
    render(
      <FilterCheckbox
        checked={false}
        onCheckedChange={vi.fn()}
        label="Failures only"
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Failures only" }),
    ).toBeTruthy();
  });
});
