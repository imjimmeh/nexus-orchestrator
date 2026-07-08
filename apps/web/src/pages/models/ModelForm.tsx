import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LLMModel } from "@/lib/api/models.types";
import { LLMProvider } from "@/lib/api/providers.types";
import {
  useModelFormPresets,
  useModelFormState,
} from "./ModelForm.hooks";
import { ModelFormCostRateField } from "./ModelFormCostRateField";
import { ModelFormDefaultUsageFields } from "./ModelFormDefaultUsageFields";
import { ModelFormEmbeddingFields } from "./ModelFormEmbeddingFields";
import { ModelFormPresetSelect } from "./ModelFormPresetSelect";
import { ModelFormThinkingLevelField } from "./ModelFormThinkingLevelField";

export interface ModelFormProps {
  model?: LLMModel;
  provider: LLMProvider;
  onSubmit: (data: {
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
  }) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function resolveSubmitLabel(
  model: LLMModel | undefined,
  isSubmitting: boolean,
): string {
  if (isSubmitting) {
    return "Saving...";
  }
  return model ? "Update" : "Create";
}

export function ModelForm({
  model,
  provider,
  onSubmit,
  onCancel,
  isSubmitting,
}: Readonly<ModelFormProps>) {
  const submitLabel = resolveSubmitLabel(model, isSubmitting);
  const form = useModelFormState({ provider, model });
  const { presets, presetSupportedLevels, handlePresetChange } =
    useModelFormPresets({ provider, model, setValue: form.setValue });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <ModelFormPresetSelect
          presets={presets}
          onChange={handlePresetChange}
        />

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g., GPT-4" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="token_limit"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Token Limit</FormLabel>
              <FormControl>
                <Input type="number" placeholder="e.g., 4096" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <ModelFormCostRateField
          control={form.control}
          name="input_token_cents_per_million"
          label="Input Cost (cents per million tokens)"
          placeholder="e.g., 15"
        />

        <ModelFormCostRateField
          control={form.control}
          name="output_token_cents_per_million"
          label="Output Cost (cents per million tokens)"
          placeholder="e.g., 60"
        />

        <ModelFormDefaultUsageFields control={form.control} />

        <ModelFormEmbeddingFields
          control={form.control}
          watch={form.watch}
        />

        {presetSupportedLevels !== null && (
          <ModelFormThinkingLevelField
            control={form.control}
            supportedLevels={presetSupportedLevels}
          />
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}