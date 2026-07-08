import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LLMModel } from "@/lib/api/models.types";
import { LLMProvider } from "@/lib/api/providers.types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ModelForm } from "./ModelForm";

vi.mock("@/hooks/useModels", () => ({
  useModelPresets: () => ({
    data: [
      {
        id: "gpt-4",
        name: "GPT-4",
        provider: "openai",
        contextWindow: 8192,
        supportedThinkingLevels: [],
      },
      {
        id: "claude-3",
        name: "Claude 3",
        provider: "anthropic",
        contextWindow: 8192,
        supportedThinkingLevels: [],
      },
      {
        id: "gpt-4-thinking",
        name: "GPT-4 Thinking",
        provider: "openai",
        contextWindow: 16384,
        supportedThinkingLevels: ["off", "high", "xhigh"],
        cost: { input: 0.03, output: 0.06, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  }),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function createWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const providers: LLMProvider[] = [
  {
    id: "provider-1",
    name: "openai",
    provider_id: "openai",
    auth_type: "api_key",
    runtime_env: {},
    is_active: true,
    created_at: "2026-06-04T00:00:00.000Z",
    updated_at: "2026-06-04T00:00:00.000Z",
  },
];

const model: LLMModel = {
  id: "model-1",
  name: "gpt-test",
  provider_name: "openai",
  token_limit: 4096,
  input_token_cents_per_million: 15,
  output_token_cents_per_million: 60,
  default_for_execution: false,
  default_for_distillation: false,
  default_for_summarization: false,
  default_for_session: false,
  supports_embedding: false,
  default_for_embedding: false,
  is_active: true,
  created_at: "2026-06-04T00:00:00.000Z",
  updated_at: "2026-06-04T00:00:00.000Z",
};

describe("ModelForm", () => {
  it("uses whole-cent placeholders for cost fields", () => {
    render(
      <ModelForm
        provider={providers[0]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByPlaceholderText("e.g., 15")).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g., 60")).toBeTruthy();
  });

  it("allows an existing model cost to be cleared while editing", async () => {
    const user = userEvent.setup();

    render(
      <ModelForm
        model={model}
        provider={providers[0]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
      { wrapper: createWrapper() },
    );

    const inputCost = screen.getByLabelText(
      "Input Cost (cents per million tokens)",
    ) as HTMLInputElement;

    expect(inputCost.value).toBe("15");

    await user.clear(inputCost);

    expect(inputCost.value).toBe("");
  });

  it("only displays preset models for configured providers", async () => {
    const user = userEvent.setup();

    render(
      <ModelForm
        provider={providers[0]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
      { wrapper: createWrapper() },
    );

    const presetSelect = screen.getByRole("combobox");
    await user.click(presetSelect);

    expect(screen.getByRole("option", { name: "GPT-4 (openai)" })).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: "Claude 3 (anthropic)" }),
    ).toBeNull();
  });

  describe("thinking level dropdown", () => {
    it("shows Inherit/None + supportedThinkingLevels when a preset is selected", async () => {
      const user = userEvent.setup();

      render(
        <ModelForm
          provider={providers[0]}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          isSubmitting={false}
        />,
        { wrapper: createWrapper() },
      );

      const presetSelect = screen.getByRole("combobox");
      await user.click(presetSelect);
      await user.click(
        screen.getByRole("option", { name: "GPT-4 Thinking (openai)" }),
      );

      // The thinking level dropdown should appear with the preset's supported levels
      const thinkingLevelSelect = screen.getByRole("combobox", {
        name: /thinking level/i,
      });
      expect(thinkingLevelSelect).toBeTruthy();

      await user.click(thinkingLevelSelect);

      expect(screen.getByRole("option", { name: /inherit/i })).toBeTruthy();
      expect(screen.getByRole("option", { name: "off" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "high" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "xhigh" })).toBeTruthy();

      // "low" and "medium" are NOT in supportedThinkingLevels
      expect(screen.queryByRole("option", { name: "low" })).toBeNull();
      expect(screen.queryByRole("option", { name: "medium" })).toBeNull();
    });

    it("includes default_thinking_level in the submit payload when a level is selected", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();

      render(
        <ModelForm
          provider={providers[0]}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          isSubmitting={false}
        />,
        { wrapper: createWrapper() },
      );

      // Select the thinking-level-aware preset
      const presetSelect = screen.getByRole("combobox");
      await user.click(presetSelect);
      await user.click(
        screen.getByRole("option", { name: "GPT-4 Thinking (openai)" }),
      );

      // Select "high" from the thinking level dropdown
      const thinkingLevelSelect = screen.getByRole("combobox", {
        name: /thinking level/i,
      });
      await user.click(thinkingLevelSelect);
      await user.click(screen.getByRole("option", { name: "high" }));

      // Submit the form
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ default_thinking_level: "high" }),
        expect.anything(), // react-hook-form passes the submit event as second argument
      );
    });

    it("renders thinking level control disabled when supportedThinkingLevels is empty", async () => {
      const user = userEvent.setup();

      render(
        <ModelForm
          provider={providers[0]}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          isSubmitting={false}
        />,
        { wrapper: createWrapper() },
      );

      // Select a preset with no thinking levels
      const presetSelect = screen.getByRole("combobox");
      await user.click(presetSelect);
      await user.click(screen.getByRole("option", { name: "GPT-4 (openai)" }));

      // The control should be disabled with the hint text
      expect(
        screen.getByText("model has no configurable thinking levels"),
      ).toBeTruthy();

      const thinkingLevelTrigger = screen.getByRole("combobox", {
        name: /thinking level/i,
      });
      expect(thinkingLevelTrigger).toHaveAttribute("disabled");
    });
  });
});
