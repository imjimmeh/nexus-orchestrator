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
import {
  POLICY_FORM_ENFORCEMENT_MODES,
  POLICY_FORM_WINDOW_OPTIONS,
} from "./PolicyForm.hooks";
import type { PolicyFormSectionProps } from "./PolicyForm.hooks.types";

export function PolicyFormWindowSection({
  control,
}: Readonly<PolicyFormSectionProps>) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <FormField
        control={control}
        name="window"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Window</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select window" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {POLICY_FORM_WINDOW_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
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
        name="enforcement_mode"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Enforcement Mode</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {POLICY_FORM_ENFORCEMENT_MODES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
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
