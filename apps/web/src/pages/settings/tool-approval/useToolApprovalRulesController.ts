import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { CreateToolApprovalRuleRequest, UpdateToolApprovalRuleRequest } from "@/lib/api/tool-policy.types";
import {
  defaultFormState,
  toFormState,
  toMutationPayload,
  toUpdatePayload,
} from "./toolApprovalRule.mappers";
import type {
  EffectFilter,
  RuleFormState,
  ScopeFilter,
} from "./toolApprovalRule.types";
import { validateToolApprovalRuleForm } from "./toolApprovalRule.validation";

export function useToolApprovalRulesController() {
  const queryClient = useQueryClient();
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [effectFilter, setEffectFilter] = useState<EffectFilter>("all");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(defaultFormState);
  const [error, setError] = useState<string | null>(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: queryKeys.settings.toolApprovalRules({
      scopeFilter,
      effectFilter,
    }),
    queryFn: () =>
      api.listToolApprovalRules({
        scopeType: scopeFilter === "all" ? undefined : scopeFilter,
        effect: effectFilter === "all" ? undefined : effectFilter,
      }),
  });

  const createMutation = useMutation({
    mutationFn: (request: CreateToolApprovalRuleRequest) =>
      api.createToolApprovalRule(request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.settings.toolApprovalRules(),
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (params: {
      id: string;
      request: UpdateToolApprovalRuleRequest;
    }) => api.updateToolApprovalRule(params.id, params.request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.settings.toolApprovalRules(),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteToolApprovalRule(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.settings.toolApprovalRules(),
      });
    },
  });

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => a.priority - b.priority),
    [rules],
  );

  const submitForm = async () => {
    const validationError = validateToolApprovalRuleForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setError(null);
      if (editingRuleId) {
        await updateMutation.mutateAsync({
          id: editingRuleId,
          request: toUpdatePayload(form),
        });
      } else {
        await createMutation.mutateAsync(toMutationPayload(form));
      }

      setEditingRuleId(null);
      setForm(defaultFormState);
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Unable to save tool approval rule",
      );
    }
  };

  return {
    scopeFilter,
    setScopeFilter,
    effectFilter,
    setEffectFilter,
    editingRuleId,
    setEditingRuleId,
    form,
    setForm,
    error,
    setError,
    isLoading,
    sortedRules,
    createMutation,
    updateMutation,
    deleteMutation,
    isSaving: createMutation.isPending || updateMutation.isPending,
    submitForm,
    startEditingRule: (rule: (typeof rules)[number]) => {
      setEditingRuleId(rule.id);
      setForm(toFormState(rule));
      setError(null);
    },
    cancelEdit: () => {
      setEditingRuleId(null);
      setForm(defaultFormState);
      setError(null);
    },
    deleteRule: (ruleId: string) => deleteMutation.mutateAsync(ruleId),
  };
}
