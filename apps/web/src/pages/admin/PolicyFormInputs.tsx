import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { PolicyFormControls } from "./PolicyForm.hooks.types";

export function nullableStringToDisplay(
  value: string | null | undefined,
): string {
  return value ?? "";
}

export function displayToNullableString(value: string): string | null {
  return value === "" ? null : value;
}

export function nullableNumberToDisplay(
  value: number | null | undefined,
): string {
  return value === null || value === undefined ? "" : String(value);
}

export function displayToNullableNumber(value: string): number | null {
  if (value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type PolicyFormNullableStringFieldName =
  | "scope_id"
  | "context_type"
  | "context_id";

interface PolicyFormNullableStringFieldProps {
  control: PolicyFormControls;
  name: PolicyFormNullableStringFieldName;
  label: string;
  placeholder?: string;
}

export function PolicyFormNullableStringField({
  control,
  name,
  label,
  placeholder = "Optional",
}: Readonly<PolicyFormNullableStringFieldProps>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              placeholder={placeholder}
              {...field}
              value={nullableStringToDisplay(field.value)}
              onChange={(e) => field.onChange(displayToNullableString(e.target.value))}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

type PolicyFormNullableNumberFieldName =
  | "soft_limit_cents"
  | "hard_limit_cents"
  | "token_limit";

interface PolicyFormNullableNumberFieldProps {
  control: PolicyFormControls;
  name: PolicyFormNullableNumberFieldName;
  label: string;
  placeholder?: string;
}

export function PolicyFormNullableNumberField({
  control,
  name,
  label,
  placeholder = "Optional",
}: Readonly<PolicyFormNullableNumberFieldProps>) {
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
              placeholder={placeholder}
              {...field}
              value={nullableNumberToDisplay(field.value)}
              onChange={(e) =>
                field.onChange(displayToNullableNumber(e.target.value))
              }
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
