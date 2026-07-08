import { Form } from "@/components/ui/form";
import {
  toModelOptions,
  toProviderOptions,
  usePolicyFormState,
} from "./PolicyForm.hooks";
import type { PolicyFormProps } from "./PolicyForm.hooks.types";
import { PolicyFormActions } from "./PolicyFormActions";
import { PolicyFormIdentitySection } from "./PolicyFormIdentitySection";
import { PolicyFormLimitsSection } from "./PolicyFormLimitsSection";
import { PolicyFormProviderSection } from "./PolicyFormProviderSection";
import { PolicyFormScopeSection } from "./PolicyFormScopeSection";
import { PolicyFormStatusSection } from "./PolicyFormStatusSection";
import { PolicyFormWindowSection } from "./PolicyFormWindowSection";

export type {
  PolicyFormProps,
  ModelOption,
  ProviderOption,
} from "./PolicyForm.hooks.types";

export function PolicyForm({
  policy,
  providers,
  models,
  onSubmit,
  onCancel,
  isSubmitting,
}: Readonly<PolicyFormProps>) {
  const providerOptions = toProviderOptions(providers);
  const modelOptions = toModelOptions(models);

  const { form, filteredModels, onProviderChange } = usePolicyFormState({
    policy,
    models: modelOptions,
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <PolicyFormIdentitySection control={form.control} />
        <PolicyFormScopeSection control={form.control} />
        <PolicyFormProviderSection
          control={form.control}
          providers={providerOptions}
          filteredModels={filteredModels}
          onProviderChange={onProviderChange}
        />
        <PolicyFormLimitsSection control={form.control} />
        <PolicyFormWindowSection control={form.control} />
        <PolicyFormStatusSection control={form.control} />
        <PolicyFormActions
          policy={policy}
          isSubmitting={isSubmitting}
          onCancel={onCancel}
        />
      </form>
    </Form>
  );
}
