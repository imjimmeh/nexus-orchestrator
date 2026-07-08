import { render, screen, fireEvent } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { Form } from "@/components/ui/form";
import { CredentialSection } from "./CredentialSection";
import type { FormData } from "./ProviderFormFields";

function Harness({ secrets = [] as never[] }) {
  const form = useForm<FormData>({
    defaultValues: {
      name: "OpenAI",
      auth_type: "api_key",
      credential_mode: "create",
      api_key: "",
      headers: [],
      extra_values: [],
    } as FormData,
  });
  return (
    <Form {...form}>
      <CredentialSection form={form} secrets={secrets} isEdit={false} />
    </Form>
  );
}

describe("CredentialSection", () => {
  it("shows the API Key field in create mode", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/API Key/i)).toBeInTheDocument();
  });

  it("lets the user add a custom header row", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /add header/i }));
    expect(screen.getByPlaceholderText(/header name/i)).toBeInTheDocument();
  });
});
