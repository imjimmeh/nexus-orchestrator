import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import type { PolicyFormSectionProps } from "./PolicyForm.hooks.types";

export function PolicyFormStatusSection({
  control,
}: Readonly<PolicyFormSectionProps>) {
  return (
    <FormField
      control={control}
      name="is_active"
      render={({ field }) => (
        <FormItem className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <FormLabel>Active</FormLabel>
          </div>
          <FormControl>
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  );
}
