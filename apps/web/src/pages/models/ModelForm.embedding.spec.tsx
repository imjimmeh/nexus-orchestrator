import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LLMModel } from "@/lib/api/models.types";
import { LLMProvider } from "@/lib/api/providers.types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ModelForm } from "./ModelForm";

vi.mock("@/hooks/useModels", () => ({
  useModelPresets: () => ({ data: [] }),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function createWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const provider: LLMProvider = {
  id: "provider-1",
  name: "voyage",
  provider_id: "voyage",
  auth_type: "api_key",
  runtime_env: {},
  is_active: true,
  created_at: "2026-06-25T00:00:00.000Z",
  updated_at: "2026-06-25T00:00:00.000Z",
};

const embeddingModel: LLMModel = {
  id: "embed-model-1",
  name: "voyage-3.5",
  provider_name: "voyage",
  token_limit: 8192,
  input_token_cents_per_million: null,
  output_token_cents_per_million: null,
  default_for_execution: false,
  default_for_distillation: false,
  default_for_summarization: false,
  default_for_session: false,
  supports_embedding: true,
  embedding_dimension: 1024,
  default_for_embedding: true,
  is_active: true,
  created_at: "2026-06-25T00:00:00.000Z",
  updated_at: "2026-06-25T00:00:00.000Z",
};

describe("ModelForm — embedding fields", () => {
  it("renders supports_embedding checkbox", () => {
    render(
      <ModelForm
        provider={provider}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
      { wrapper: createWrapper() },
    );

    expect(
      screen.getByRole("checkbox", { name: /supports embedding/i }),
    ).toBeTruthy();
  });

  it("shows embedding_dimension input only when supports_embedding is checked", async () => {
    const user = userEvent.setup();

    render(
      <ModelForm
        provider={provider}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
      { wrapper: createWrapper() },
    );

    // Initially not shown
    expect(screen.queryByLabelText(/embedding dimension/i)).toBeNull();

    const supportsEmbeddingCheckbox = screen.getByRole("checkbox", {
      name: /supports embedding/i,
    });
    await user.click(supportsEmbeddingCheckbox);

    // Now shown
    expect(screen.getByLabelText(/embedding dimension/i)).toBeTruthy();
  });

  it("round-trips supports_embedding + embedding_dimension + default_for_embedding from existing model", async () => {
    const onSubmit = vi.fn();

    render(
      <ModelForm
        model={embeddingModel}
        provider={provider}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
      { wrapper: createWrapper() },
    );

    const supportsEmbeddingCheckbox = screen.getByRole("checkbox", {
      name: /supports embedding/i,
    });
    expect(supportsEmbeddingCheckbox.getAttribute("aria-checked")).toBe("true");

    const dimensionInput = screen.getByLabelText(
      /embedding dimension/i,
    ) as HTMLInputElement;
    expect(dimensionInput.value).toBe("1024");

    const defaultEmbeddingCheckbox = screen.getByRole("checkbox", {
      name: /default for embedding/i,
    });
    expect(defaultEmbeddingCheckbox.getAttribute("aria-checked")).toBe("true");

    const submitButton = screen.getByRole("button", { name: /update/i });
    await userEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        supports_embedding: true,
        embedding_dimension: 1024,
        default_for_embedding: true,
      }),
      expect.anything(),
    );
  });
});
