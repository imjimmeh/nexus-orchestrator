import type { UseFormReturn } from "react-hook-form";
import { LLMModel } from "@/lib/api/models.types";
import { LLMProvider } from "@/lib/api/providers.types";

export type ModelFormData = {
  name: string;
  provider_name?: string;
  token_limit: number;
  input_token_cents_per_million?: number | null;
  output_token_cents_per_million?: number | null;
  default_for_execution: boolean;
  default_for_distillation: boolean;
  default_for_summarization: boolean;
  default_for_session: boolean;
  supports_embedding: boolean;
  embedding_dimension?: number | null;
  default_for_embedding: boolean;
  default_thinking_level?: string | null;
};

export type ModelFormControls = UseFormReturn<ModelFormData>["control"];
export type ModelFormSetValue = UseFormReturn<ModelFormData>["setValue"];
export type ModelFormWatch = UseFormReturn<ModelFormData>["watch"];

export interface ModelFormPresetOption {
  id: string;
  name: string;
  provider: string;
}

export interface ModelFormPresetState {
  presets: ModelFormPresetOption[];
  presetSupportedLevels: string[] | null;
  handlePresetChange: (presetId: string) => void;
}

export interface UseModelFormStateParams {
  provider: LLMProvider;
  model?: LLMModel;
}

export interface UseModelFormPresetsParams {
  provider: LLMProvider;
  model?: LLMModel;
  setValue: ModelFormSetValue;
}