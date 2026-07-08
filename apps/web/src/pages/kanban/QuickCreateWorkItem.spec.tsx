import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QuickCreateWorkItem } from "./QuickCreateWorkItem";

describe("QuickCreateWorkItem", () => {
  it("renders add button when collapsed", () => {
    render(<QuickCreateWorkItem isPending={false} onSubmit={vi.fn()} />);

    expect(screen.getByText("+ Add item")).toBeTruthy();
  });

  it("expands to input on button click", () => {
    render(<QuickCreateWorkItem isPending={false} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByText("+ Add item"));

    const input = screen.getByPlaceholderText("What needs to be done?");
    expect(input).toBeTruthy();
  });

  it("submits title on Enter and collapses", () => {
    const onSubmit = vi.fn();
    render(<QuickCreateWorkItem isPending={false} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("+ Add item"));
    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "My task" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("What needs to be done?"), {
      key: "Enter",
    });

    expect(onSubmit).toHaveBeenCalledWith("My task");
    expect(screen.getByText("+ Add item")).toBeTruthy();
  });

  it("does not submit empty title", () => {
    const onSubmit = vi.fn();
    render(<QuickCreateWorkItem isPending={false} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("+ Add item"));
    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "   " },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("What needs to be done?"), {
      key: "Enter",
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("collapses on Escape without submitting", () => {
    const onSubmit = vi.fn();
    render(<QuickCreateWorkItem isPending={false} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("+ Add item"));
    fireEvent.change(screen.getByPlaceholderText("What needs to be done?"), {
      target: { value: "Cancel me" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("What needs to be done?"), {
      key: "Escape",
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("+ Add item")).toBeTruthy();
  });

  it("collapses on blur when input is empty", () => {
    render(<QuickCreateWorkItem isPending={false} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByText("+ Add item"));
    fireEvent.blur(screen.getByPlaceholderText("What needs to be done?"));

    expect(screen.getByText("+ Add item")).toBeTruthy();
  });

  it("renders disabled state when isPending", () => {
    render(<QuickCreateWorkItem isPending onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByText("+ Add item"));

    const input = screen.getByPlaceholderText(
      "What needs to be done?",
    ) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
