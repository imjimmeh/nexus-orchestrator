import type { UseFormReturn } from "react-hook-form";
import type { BudgetPolicy } from "@/lib/api/client.budget.types";
import { LLMModel } from "@/lib/api/models.types";
import { LLMProvider } from "@/lib/api/providers.types";

export interface ProviderOption {
  id: string;
  name: string;
}

export interface ModelOption {
  id: string;
  name: string;
  provider_name?: string | null;
}

export type PolicyFormValues = {
  name: string;
  scope_type: string;
  scope_id: string | null;
  context_type: string | null;
  context_id: string | null;
  provider_name: string | null;
  model_name: string | null;
  soft_limit_cents: number | null;
  hard_limit_cents: number | null;
  token_limit: number | null;
  window: string;
  enforcement_mode: string;
  is_active: boolean;
};

export type PolicyFormControls = UseFormReturn<PolicyFormValues>["control"];
export type PolicyFormSetValue = UseFormReturn<PolicyFormValues>["setValue"];
export type PolicyFormWatch = UseFormReturn<PolicyFormValues>["watch"];

export interface PolicyFormProps {
  policy?: BudgetPolicy;
  providers: LLMProvider[] | ProviderOption[];
  models: LLMModel[] | ModelOption[];
  onSubmit: (data: PolicyFormValues) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export interface PolicyFormSectionProps {
  control: PolicyFormControls;
}

export interface PolicyFormProviderSectionProps extends PolicyFormSectionProps {
  providers: ProviderOption[];
  filteredModels: ModelOption[];
  onProviderChange: () => void;
}

export interface UsePolicyFormStateResult {
  form: UseFormReturn<PolicyFormValues>;
  filteredModels: ModelOption[];
  onProviderChange: () => void;
}

export interface UsePolicyFormStateParams {
  policy: BudgetPolicy | undefined;
  models: ModelOption[];
}
