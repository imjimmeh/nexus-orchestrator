import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TextareaField } from "./TextareaField";

describe("TextareaField", () => {
  it("renders label and textarea", () => {
    render(<TextareaField label="Description" value="" onChange={() => {}} />);

    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("renders with value", () => {
    render(
      <TextareaField
        label="Description"
        value="Hello world"
        onChange={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hello world");
  });

  it("calls onChange when typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TextareaField label="Description" value="" onChange={onChange} />);

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("renders placeholder", () => {
    render(
      <TextareaField
        label="Description"
        value=""
        onChange={() => {}}
        placeholder="Enter description"
      />,
    );

    expect(screen.getByPlaceholderText("Enter description")).toBeTruthy();
  });

  it("renders description text", () => {
    render(
      <TextareaField
        label="Description"
        value=""
        onChange={() => {}}
        description="Optional description"
      />,
    );

    expect(screen.getByText("Optional description")).toBeTruthy();
  });

  it("renders error state with red border and error text", () => {
    const { container } = render(
      <TextareaField
        label="Description"
        value=""
        onChange={() => {}}
        error="Too long"
      />,
    );

    expect(screen.getByText("Too long")).toBeTruthy();
    expect(screen.getByText("Too long").className).toContain(
      "text-destructive",
    );
    const textarea = container.querySelector("textarea");
    expect(textarea?.className).toContain("border-destructive");
  });

  it("renders with custom rows", () => {
    const { container } = render(
      <TextareaField
        label="Description"
        value=""
        onChange={() => {}}
        rows={10}
      />,
    );

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.rows).toBe(10);
  });

  it("defaults rows to 3 when not specified", () => {
    const { container } = render(
      <TextareaField label="Description" value="" onChange={() => {}} />,
    );

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.rows).toBe(3);
  });

  it("does not render error text when no error", () => {
    render(<TextareaField label="Description" value="" onChange={() => {}} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.className).not.toContain("border-destructive");
  });
});
