import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TextField } from "./TextField";

describe("TextField", () => {
  it("renders label and input", () => {
    render(<TextField label="Name" value="" onChange={() => {}} />);

    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("renders with value", () => {
    render(<TextField label="Name" value="Hello" onChange={() => {}} />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("Hello");
  });

  it("calls onChange when typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TextField label="Name" value="" onChange={onChange} />);

    const input = screen.getByRole("textbox");
    await user.type(input, "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("renders placeholder", () => {
    render(
      <TextField
        label="Name"
        value=""
        onChange={() => {}}
        placeholder="Enter name"
      />,
    );

    expect(screen.getByPlaceholderText("Enter name")).toBeTruthy();
  });

  it("renders description text", () => {
    render(
      <TextField
        label="Name"
        value=""
        onChange={() => {}}
        description="Your full name"
      />,
    );

    expect(screen.getByText("Your full name")).toBeTruthy();
  });

  it("renders error state with red border and error text", () => {
    const { container } = render(
      <TextField
        label="Name"
        value=""
        onChange={() => {}}
        error="Required field"
      />,
    );

    expect(screen.getByText("Required field")).toBeTruthy();
    expect(screen.getByText("Required field").className).toContain(
      "text-destructive",
    );
    const input = container.querySelector("input");
    expect(input?.className).toContain("border-destructive");
  });

  it("renders disabled state", () => {
    render(
      <TextField label="Name" value="Read only" onChange={() => {}} disabled />,
    );

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("does not render error text when no error", () => {
    render(<TextField label="Name" value="" onChange={() => {}} />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.className).not.toContain("border-destructive");
  });
});
