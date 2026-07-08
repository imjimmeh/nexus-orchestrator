import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import type { BudgetPolicy } from "@/lib/api/client.budget.types";
import type {
  ModelOption,
  PolicyFormControls,
  PolicyFormSetValue,
  PolicyFormValues,
  ProviderOption,
  UsePolicyFormStateParams,
  UsePolicyFormStateResult,
} from "./PolicyForm.hooks.types";

export const POLICY_FORM_NONE_VALUE = "__none__";

export const POLICY_FORM_SCOPE_TYPES = [
  { value: "global", label: "Global" },
  { value: "scope", label: "Scope" },
  { value: "context", label: "Context" },
  { value: "workflow_definition", label: "Workflow Definition" },
  { value: "agent_profile", label: "Agent Profile" },
  { value: "provider", label: "Provider" },
  { value: "model", label: "Model" },
] as const;

export const POLICY_FORM_WINDOW_OPTIONS = [
  { value: "per_run", label: "Per Run" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "rolling", label: "Rolling" },
] as const;

export const POLICY_FORM_ENFORCEMENT_MODES = [
  { value: "warn", label: "Warn" },
  { value: "block", label: "Block" },
] as const;

export const policyFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  scope_type: z.string().min(1, "Scope type is required"),
  scope_id: z.string().nullable().optional(),
  context_type: z.string().nullable().optional(),
  context_id: z.string().nullable().optional(),
  provider_name: z.string().nullable().optional(),
  model_name: z.string().nullable().optional(),
  soft_limit_cents: z.coerce.number().nullable().optional(),
  hard_limit_cents: z.coerce.number().nullable().optional(),
  token_limit: z.coerce.number().nullable().optional(),
  window: z.string().min(1, "Window is required"),
  enforcement_mode: z.string().min(1, "Enforcement mode is required"),
  is_active: z.boolean().default(true),
});

function readString(value: string | null | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: number | null | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function readBoolean(value: boolean | null | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function buildPolicyDefaultValues(
  policy: BudgetPolicy | undefined,
): PolicyFormValues {
  if (!policy) {
    return {
      name: "",
      scope_type: "global",
      scope_id: null,
      context_type: null,
      context_id: null,
      provider_name: null,
      model_name: null,
      soft_limit_cents: null,
      hard_limit_cents: null,
      token_limit: null,
      window: "monthly",
      enforcement_mode: "warn",
      is_active: true,
    };
  }

  return {
    name: readString(policy.name),
    scope_type: readString(policy.scope_type, "global"),
    scope_id: policy.scope_id,
    context_type: policy.context_type,
    context_id: policy.context_id,
    provider_name: policy.provider_name,
    model_name: policy.model_name,
    soft_limit_cents: readNumber(policy.soft_limit_cents),
    hard_limit_cents: readNumber(policy.hard_limit_cents),
    token_limit: readNumber(policy.token_limit),
    window: readString(policy.window, "monthly"),
    enforcement_mode: readString(policy.enforcement_mode, "warn"),
    is_active: readBoolean(policy.is_active, true),
  };
}

export function usePolicyFormState({
  policy,
  models,
}: UsePolicyFormStateParams): UsePolicyFormStateResult {
  const form = useForm<PolicyFormValues>({
    resolver: zodResolver(policyFormSchema as never),
    defaultValues: buildPolicyDefaultValues(policy),
  });

  const selectedProvider = form.watch("provider_name");
  const filteredModels: ModelOption[] = selectedProvider
    ? models.filter((m) => m.provider_name === selectedProvider)
    : models;

  const onProviderChange = () => {
    form.setValue("model_name", null);
  };

  return { form, filteredModels, onProviderChange };
}

export function toProviderOptions(
  providers: readonly { id: string; name: string }[],
): ProviderOption[] {
  return providers.map((p) => ({ id: p.id, name: p.name }));
}

export function toModelOptions(
  models: readonly { id: string; name: string; provider_name?: string | null }[],
): ModelOption[] {
  return models.map((m) => ({
    id: m.id,
    name: m.name,
    provider_name: m.provider_name ?? null,
  }));
}

export type { PolicyFormControls, PolicyFormSetValue, PolicyFormValues };
