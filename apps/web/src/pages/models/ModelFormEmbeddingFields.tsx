import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type {
  ModelFormControls,
  ModelFormWatch,
} from "./ModelForm.hooks.types";

interface ModelFormEmbeddingFieldsProps {
  control: ModelFormControls;
  watch: ModelFormWatch;
}

export function ModelFormEmbeddingFields({
  control,
  watch,
}: Readonly<ModelFormEmbeddingFieldsProps>) {
  const supportsEmbedding = watch("supports_embedding");

  return (
    <div className="space-y-2">
      <FormLabel>Embedding</FormLabel>
      <div className="space-y-2">
        <FormField
          control={control}
          name="supports_embedding"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Supports Embedding</FormLabel>
              </div>
            </FormItem>
          )}
        />

        {supportsEmbedding && (
          <FormField
            control={control}
            name="embedding_dimension"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Embedding Dimension</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    placeholder="e.g., 1536"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      field.onChange(val === "" ? null : Number(val));
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={control}
          name="default_for_embedding"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Default for Embedding</FormLabel>
              </div>
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}