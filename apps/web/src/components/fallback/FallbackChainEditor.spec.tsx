import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FallbackChainEditor } from "./FallbackChainEditor";

const providers = [{ name: "a" }, { name: "b" }];
const models = [{ name: "m1" }, { name: "m2" }];

describe("FallbackChainEditor", () => {
  it("renders one combobox pair per entry", () => {
    render(
      <FallbackChainEditor
        value={[
          { provider_name: "a", model_name: "m1" },
          { provider_name: "b", model_name: "m2" },
        ]}
        onChange={vi.fn()}
        providers={providers}
        models={models}
      />,
    );
    // 2 rows × (1 provider select + 1 model select) = 4 comboboxes
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
  });

  it("shows empty-state text when value is empty", () => {
    render(
      <FallbackChainEditor
        value={[]}
        onChange={vi.fn()}
        providers={providers}
        models={models}
      />,
    );
    expect(screen.getByText(/no fallback/i)).toBeInTheDocument();
  });

  it("appends an empty row on Add fallback", () => {
    const onChange = vi.fn();
    render(
      <FallbackChainEditor
        value={[{ provider_name: "a", model_name: "m1" }]}
        onChange={onChange}
        providers={providers}
        models={models}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add fallback/i }));
    expect(onChange).toHaveBeenCalledWith([
      { provider_name: "a", model_name: "m1" },
      { provider_name: "", model_name: "" },
    ]);
  });

  it("removes row 0 when the first remove button is clicked", () => {
    const onChange = vi.fn();
    render(
      <FallbackChainEditor
        value={[
          { provider_name: "a", model_name: "m1" },
          { provider_name: "b", model_name: "m2" },
        ]}
        onChange={onChange}
        providers={providers}
        models={models}
      />,
    );
    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith([
      { provider_name: "b", model_name: "m2" },
    ]);
  });

  it("swaps row 0 and row 1 when Move down is clicked on row 0", () => {
    const onChange = vi.fn();
    render(
      <FallbackChainEditor
        value={[
          { provider_name: "a", model_name: "m1" },
          { provider_name: "b", model_name: "m2" },
        ]}
        onChange={onChange}
        providers={providers}
        models={models}
      />,
    );
    const moveDownButtons = screen.getAllByRole("button", {
      name: /move down/i,
    });
    fireEvent.click(moveDownButtons[0]);
    expect(onChange).toHaveBeenCalledWith([
      { provider_name: "b", model_name: "m2" },
      { provider_name: "a", model_name: "m1" },
    ]);
  });
});
