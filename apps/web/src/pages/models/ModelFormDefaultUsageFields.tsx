import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import type { ModelFormControls } from "./ModelForm.hooks.types";

interface ModelFormDefaultUsageFieldsProps {
  control: ModelFormControls;
}

interface BooleanFieldRowProps {
  control: ModelFormControls;
  name:
    | "default_for_execution"
    | "default_for_distillation"
    | "default_for_summarization"
    | "default_for_session";
  label: string;
}

function BooleanFieldRow({
  control,
  name,
  label,
}: Readonly<BooleanFieldRowProps>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
          <FormControl>
            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
          <div className="space-y-1 leading-none">
            <FormLabel>{label}</FormLabel>
          </div>
        </FormItem>
      )}
    />
  );
}

export function ModelFormDefaultUsageFields({
  control,
}: Readonly<ModelFormDefaultUsageFieldsProps>) {
  return (
    <div className="space-y-2">
      <FormLabel>Default Usage</FormLabel>
      <div className="space-y-2">
        <BooleanFieldRow
          control={control}
          name="default_for_execution"
          label="Default for Execution"
        />
        <BooleanFieldRow
          control={control}
          name="default_for_distillation"
          label="Default for Distillation"
        />
        <BooleanFieldRow
          control={control}
          name="default_for_summarization"
          label="Default for Summarization"
        />
        <BooleanFieldRow
          control={control}
          name="default_for_session"
          label="Default for Session"
        />
      </div>
    </div>
  );
}