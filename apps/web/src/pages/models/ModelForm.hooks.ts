import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { THINKING_LEVEL_ORDER } from "@nexus/core";
import { useModelPresets } from "@/hooks/useModels";
import { LLMModel } from "@/lib/api/models.types";
import { ModelPreset } from "@/lib/api/presets.types";
import { LLMProvider } from "@/lib/api/providers.types";
import type {
  ModelFormData,
  ModelFormPresetOption,
  ModelFormPresetState,
  UseModelFormPresetsParams,
  UseModelFormStateParams,
} from "./ModelForm.hooks.types";

export const modelFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  provider_name: z.string().optional(),
  token_limit: z.coerce.number().min(1, "Token limit must be at least 1"),
  input_token_cents_per_million: z.coerce
    .number()
    .int()
    .min(0)
    .nullable()
    .optional(),
  output_token_cents_per_million: z.coerce
    .number()
    .int()
    .min(0)
    .nullable()
    .optional(),
  default_for_execution: z.boolean().default(false),
  default_for_distillation: z.boolean().default(false),
  default_for_summarization: z.boolean().default(false),
  default_for_session: z.boolean().default(false),
  supports_embedding: z.boolean().default(false),
  embedding_dimension: z.coerce.number().int().min(1).nullable().optional(),
  default_for_embedding: z.boolean().default(false),
  default_thinking_level: z.string().nullable().optional(),
});

function readString(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function readBoolean(value: boolean | null | undefined): boolean {
  return value === true;
}

function buildDefaultUsageValues(model: LLMModel | undefined) {
  return {
    default_for_execution: readBoolean(model?.default_for_execution),
    default_for_distillation: readBoolean(model?.default_for_distillation),
    default_for_summarization: readBoolean(model?.default_for_summarization),
    default_for_session: readBoolean(model?.default_for_session),
  };
}

function buildEmbeddingValues(model: LLMModel | undefined) {
  return {
    supports_embedding: readBoolean(model?.supports_embedding),
    embedding_dimension: model?.embedding_dimension ?? null,
    default_for_embedding: readBoolean(model?.default_for_embedding),
  };
}

export function buildModelDefaultValues(
  provider: LLMProvider,
  model?: LLMModel,
): ModelFormData {
  return {
    name: readString(model?.name),
    provider_name: model?.provider_name ?? provider.name,
    token_limit: readNumber(model?.token_limit, 4096),
    input_token_cents_per_million: model?.input_token_cents_per_million ?? null,
    output_token_cents_per_million:
      model?.output_token_cents_per_million ?? null,
    ...buildDefaultUsageValues(model),
    ...buildEmbeddingValues(model),
    default_thinking_level: model?.default_thinking_level ?? null,
  };
}

export function useModelFormState({
  provider,
  model,
}: UseModelFormStateParams) {
  return useForm<ModelFormData>({
    resolver: zodResolver(modelFormSchema as never),
    defaultValues: buildModelDefaultValues(provider, model),
  });
}

function matchProviderPreset(provider: LLMProvider, preset: ModelPreset) {
  const providerId = provider.provider_id || "custom";
  return providerId.toLowerCase() === preset.provider.toLowerCase();
}

function toPresetOption(preset: ModelPreset): ModelFormPresetOption {
  return {
    id: preset.id,
    name: preset.name,
    provider: preset.provider,
  };
}

export function useModelFormPresets({
  provider,
  model,
  setValue,
}: UseModelFormPresetsParams): ModelFormPresetState {
  const { data: presets = [] } = useModelPresets();

  const filteredPresets = useMemo(
    () =>
      presets
        .filter((preset) => matchProviderPreset(provider, preset))
        .map(toPresetOption),
    [presets, provider],
  );

  // Tracks the supported thinking levels for the currently selected preset.
  // null means no preset has been chosen yet (hide the thinking-level control).
  // When editing an existing model we initialize to an empty list so the
  // control renders in its disabled state (matching the previous behavior).
  const [presetSupportedLevels, setPresetSupportedLevels] = useState<
    string[] | null
  >(model ? [] : null);

  const handlePresetChange = (presetId: string) => {
    if (presetId === "custom") return;
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;

    setValue("name", preset.id);
    setValue("token_limit", preset.contextWindow);

    if (preset.cost) {
      setValue(
        "input_token_cents_per_million",
        Math.round(preset.cost.input * 100),
      );
      setValue(
        "output_token_cents_per_million",
        Math.round(preset.cost.output * 100),
      );
    }

    setValue("provider_name", provider.name);
    setPresetSupportedLevels(preset.supportedThinkingLevels ?? []);
  };

  return {
    presets: filteredPresets,
    presetSupportedLevels,
    handlePresetChange,
  };
}

/** Returns the subset of levels that the preset supports, ordered by THINKING_LEVEL_ORDER. */
export function orderSupportedThinkingLevels(levels: string[]): string[] {
  const levelSet = new Set(levels);
  return (THINKING_LEVEL_ORDER as readonly string[]).filter((level) =>
    levelSet.has(level),
  );
}