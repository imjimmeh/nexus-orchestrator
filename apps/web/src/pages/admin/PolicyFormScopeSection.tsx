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
import { PolicyFormNullableStringField } from "./PolicyFormInputs";
import { POLICY_FORM_SCOPE_TYPES } from "./PolicyForm.hooks";
import type { PolicyFormSectionProps } from "./PolicyForm.hooks.types";

export function PolicyFormScopeSection({
  control,
}: Readonly<PolicyFormSectionProps>) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={control}
          name="scope_type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Scope Type</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select scope type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {POLICY_FORM_SCOPE_TYPES.map((opt) => (
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
        <PolicyFormNullableStringField
          control={control}
          name="scope_id"
          label="Scope ID"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <PolicyFormNullableStringField
          control={control}
          name="context_type"
          label="Context Type"
        />
        <PolicyFormNullableStringField
          control={control}
          name="context_id"
          label="Context ID"
        />
      </div>
    </div>
  );
}
