import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HandlebarsField } from "./HandlebarsField";

describe("HandlebarsField", () => {
  it("renders label and input", () => {
    render(<HandlebarsField label="Template" value="" onChange={() => {}} />);

    expect(screen.getByText("Template")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("renders with value", () => {
    render(
      <HandlebarsField label="Template" value="{{name}}" onChange={() => {}} />,
    );

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("{{name}}");
  });

  it("calls onChange when typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<HandlebarsField label="Template" value="" onChange={onChange} />);

    const input = screen.getByRole("textbox");
    await user.type(input, "Hello {{name}}");
    expect(onChange).toHaveBeenCalled();
  });

  it("renders placeholder", () => {
    render(
      <HandlebarsField
        label="Template"
        value=""
        onChange={() => {}}
        placeholder="Enter template"
      />,
    );

    expect(screen.getByPlaceholderText("Enter template")).toBeTruthy();
  });

  it("renders description text", () => {
    render(
      <HandlebarsField
        label="Template"
        value=""
        onChange={() => {}}
        description="Use {{variable}} syntax"
      />,
    );

    expect(screen.getByText("Use {{variable}} syntax")).toBeTruthy();
  });

  it("renders error state", () => {
    const { container } = render(
      <HandlebarsField
        label="Template"
        value=""
        onChange={() => {}}
        error="Invalid template"
      />,
    );

    expect(screen.getByText("Invalid template")).toBeTruthy();
    expect(screen.getByText("Invalid template").className).toContain(
      "text-destructive",
    );
    const input = container.querySelector("input");
    expect(input?.className).toContain("border-destructive");
  });

  it("renders disabled state", () => {
    render(
      <HandlebarsField
        label="Template"
        value="{{name}}"
        onChange={() => {}}
        disabled
      />,
    );

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("renders helper button when showHelper is true", () => {
    render(
      <HandlebarsField
        label="Template"
        value=""
        onChange={() => {}}
        showHelper
      />,
    );

    expect(screen.getByRole("button", { name: /handlebars/i })).toBeTruthy();
  });

  it("does not render helper button when showHelper is not set", () => {
    render(<HandlebarsField label="Template" value="" onChange={() => {}} />);

    expect(screen.queryByRole("button", { name: /handlebars/i })).toBeNull();
  });

  it("inserts {{ }} template hint when helper button is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <HandlebarsField
        label="Template"
        value=""
        onChange={onChange}
        showHelper
      />,
    );

    await user.click(screen.getByRole("button", { name: /handlebars/i }));

    expect(onChange).toHaveBeenCalledWith("{{ }}");
  });
});
