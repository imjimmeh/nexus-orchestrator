import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LLMModel } from "@/lib/api/models.types";
import { LLMProvider } from "@/lib/api/providers.types";
import { describe, expect, it, vi } from "vitest";
import { PolicyForm } from "./PolicyForm";

const providers: LLMProvider[] = [
  {
    id: "provider-1",
    name: "openai",
    provider_id: "openai",
    auth_type: "api_key",
    runtime_env: {},
    is_active: true,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  },
];

const models: LLMModel[] = [
  {
    id: "model-1",
    name: "gpt-4",
    provider_name: "openai",
    token_limit: 8192,
    input_token_cents_per_million: 15,
    output_token_cents_per_million: 60,
    default_for_execution: true,
    default_for_distillation: false,
    default_for_summarization: false,
    default_for_session: false,
    supports_embedding: false,
    default_for_embedding: false,
    is_active: true,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  },
];

describe("PolicyForm", () => {
  it("renders the create-mode submit label by default", () => {
    render(
      <PolicyForm
        providers={providers}
        models={models}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Scope Type")).toBeTruthy();
    expect(screen.getByLabelText("Window")).toBeTruthy();
    expect(screen.getByLabelText("Enforcement Mode")).toBeTruthy();
    expect(screen.getByLabelText("Soft Limit (cents)")).toBeTruthy();
    expect(screen.getByLabelText("Hard Limit (cents)")).toBeTruthy();
    expect(screen.getByLabelText("Token Limit")).toBeTruthy();
  });

  it("renders the update-mode submit label when editing an existing policy", () => {
    render(
      <PolicyForm
        policy={{
          id: "policy-1",
          name: "Existing policy",
          scope_type: "global",
          scope_id: null,
          context_type: null,
          context_id: null,
          provider_name: null,
          model_name: null,
          soft_limit_cents: 1000,
          hard_limit_cents: 2000,
          token_limit: null,
          window: "monthly",
          enforcement_mode: "warn",
          is_active: true,
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-01T00:00:00.000Z",
        }}
        providers={providers}
        models={models}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
  });

  it("submits the formatted policy payload for a new policy", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <PolicyForm
        providers={providers}
        models={models}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
    );

    await user.type(screen.getByLabelText("Name"), "Marketing guardrail");

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      name: "Marketing guardrail",
      scope_type: "global",
      window: "monthly",
      enforcement_mode: "warn",
      is_active: true,
    });
  });

  it("shows the savings label while submitting", () => {
    render(
      <PolicyForm
        providers={providers}
        models={models}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting
      />,
    );

    expect(screen.getByRole("button", { name: "Saving..." })).toBeTruthy();
  });

  it("invokes the cancel handler when the cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <PolicyForm
        providers={providers}
        models={models}
        onSubmit={vi.fn()}
        onCancel={onCancel}
        isSubmitting={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clears model_name when a different provider is selected via hook helper", async () => {
    const { usePolicyFormState } = await import("./PolicyForm.hooks");
    const openaiModel = models[0];
    if (!openaiModel) {
      throw new Error("Expected fixture model to exist");
    }
    const anthropicModel = { ...openaiModel, id: "model-2", name: "claude-3", provider_name: "anthropic" };

    const TestHook = () => {
      const { form, filteredModels, onProviderChange } = usePolicyFormState({
        policy: undefined,
        models: [openaiModel, anthropicModel] as unknown as Parameters<typeof usePolicyFormState>[0]["models"],
      });
      return (
        <div>
          <div data-testid="filtered">{filteredModels.length}</div>
          <button
            type="button"
            onClick={() => {
              form.setValue("provider_name", "anthropic");
              form.setValue("model_name", "gpt-4");
              onProviderChange();
            }}
          >
            select-then-switch
          </button>
          <span data-testid="model-name">{form.watch("model_name") ?? ""}</span>
          <span data-testid="provider-name">{form.watch("provider_name") ?? ""}</span>
        </div>
      );
    };

    render(<TestHook />);

    await userEvent.click(screen.getByRole("button", { name: "select-then-switch" }));

    expect(screen.getByTestId("model-name").textContent).toBe("");
    expect(screen.getByTestId("provider-name").textContent).toBe("anthropic");
  });
});
