import { type UseFormReturn, useFieldArray } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Secret } from "@/lib/api/secrets.types";
import type { FormData } from "./ProviderFormFields";

interface PairListProps {
  form: UseFormReturn<FormData>;
  name: "headers" | "extra_values";
  label: string;
  addLabel: string;
  namePlaceholder: string;
  valuePlaceholder: string;
}

function PairList({
  form,
  name,
  label,
  addLabel,
  namePlaceholder,
  valuePlaceholder,
}: Readonly<PairListProps>) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name,
  });
  return (
    <div className="space-y-2">
      <FormLabel>{label}</FormLabel>
      {fields.map((field, index) => (
        <div key={field.id} className="flex gap-2">
          <Input
            placeholder={namePlaceholder}
            {...form.register(`${name}.${index}.name` as const)}
          />
          <Input
            placeholder={valuePlaceholder}
            {...form.register(`${name}.${index}.value` as const)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => remove(index)}
            aria-label="Remove row"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ name: "", value: "" })}
      >
        <Plus className="h-4 w-4 mr-1" />
        {addLabel}
      </Button>
    </div>
  );
}

export function CredentialSection({
  form,
  secrets,
  isEdit,
}: Readonly<{
  form: UseFormReturn<FormData>;
  secrets: Secret[];
  isEdit: boolean;
}>) {
  const mode = form.watch("credential_mode") ?? "create";

  return (
    <div className="border rounded-md p-4 space-y-4 bg-muted/30">
      <FormField
        control={form.control}
        name="credential_mode"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Credential</FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value ?? "create"}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="create">Create new</SelectItem>
                <SelectItem value="existing">Use existing secret</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )}
      />

      {mode === "create" ? (
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="api_key"
            render={({ field }) => (
              <FormItem>
                <FormLabel>API Key</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={
                      isEdit ? "•••• set — leave blank to keep" : "sk-..."
                    }
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <PairList
            form={form}
            name="headers"
            label="Custom headers"
            addLabel="Add header"
            namePlaceholder="Header name (e.g. X-Title)"
            valuePlaceholder="Value or {{SECRET_KEY}}"
          />
          <PairList
            form={form}
            name="extra_values"
            label="Additional secret values"
            addLabel="Add value"
            namePlaceholder="Name (e.g. ORG_ID)"
            valuePlaceholder="Value"
          />
        </div>
      ) : (
        <FormField
          control={form.control}
          name="secret_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Secret</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a secret" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {secrets.length === 0 ? (
                    <SelectItem value="no-secrets" disabled>
                      No secrets available
                    </SelectItem>
                  ) : (
                    secrets.map((secret) => (
                      <SelectItem key={secret.id} value={secret.id}>
                        {secret.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
