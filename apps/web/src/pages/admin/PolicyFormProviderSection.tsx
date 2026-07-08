import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { POLICY_FORM_NONE_VALUE } from "./PolicyForm.hooks";
import type { PolicyFormProviderSectionProps } from "./PolicyForm.hooks.types";

export function PolicyFormProviderSection({
  control,
  providers,
  filteredModels,
  onProviderChange,
}: Readonly<PolicyFormProviderSectionProps>) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <FormField
        control={control}
        name="provider_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Provider</FormLabel>
            <Select
              onValueChange={(value) => {
                field.onChange(value === POLICY_FORM_NONE_VALUE ? null : value);
                onProviderChange();
              }}
              value={field.value ?? POLICY_FORM_NONE_VALUE}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Any provider" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value={POLICY_FORM_NONE_VALUE}>
                  Any provider
                </SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="model_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Model</FormLabel>
            <Select
              onValueChange={(value) => {
                field.onChange(value === POLICY_FORM_NONE_VALUE ? null : value);
              }}
              value={field.value ?? POLICY_FORM_NONE_VALUE}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Any model" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value={POLICY_FORM_NONE_VALUE}>
                  Any model
                </SelectItem>
                {filteredModels.map((m) => (
                  <SelectItem key={m.id} value={m.name}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
