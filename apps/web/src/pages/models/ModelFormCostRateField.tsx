import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { ModelFormControls } from "./ModelForm.hooks.types";

interface ModelFormCostRateFieldProps {
  control: ModelFormControls;
  name: "input_token_cents_per_million" | "output_token_cents_per_million";
  label: string;
  placeholder: string;
}

export function ModelFormCostRateField({
  control,
  name,
  label,
  placeholder,
}: Readonly<ModelFormCostRateFieldProps>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={0}
              step={1}
              placeholder={placeholder}
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
  );
}