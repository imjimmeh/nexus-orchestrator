import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useAutomationHooks,
  useCreateAutomationHook,
  useDeleteAutomationHook,
  useUpdateAutomationHook,
} from "@/hooks/useAutomationControls";
import { useToast } from "@/hooks/useToast";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { AutomationHook } from "@/lib/api/projects.types";
import { parseSchedulePayloadJson } from "./SchedulesTab.helpers";
import { AutomationHooksList } from "./SchedulesTabAutomationHooksList";
import { AutomationHookForm } from "./SchedulesTabAutomationHooksForm";
import {
  buildInitialFormState,
  type AutomationHookFormState,
  type WorkflowOption,
} from "./SchedulesTabAutomationHooksCard.shared";

interface SchedulesTabAutomationHooksCardProps {
  readonly projectId: string;
  readonly workflows: WorkflowOption[];
}

interface AutomationHooksCardContentProps {
  readonly formState: AutomationHookFormState;
  readonly workflows: WorkflowOption[];
  readonly hooks: AutomationHook[];
  readonly hooksLoading: boolean;
  readonly createPending: boolean;
  readonly updatePending: boolean;
  readonly deletePending: boolean;
  readonly onFormStateChange: (
    updater: (state: AutomationHookFormState) => AutomationHookFormState,
  ) => void;
  readonly onCreateHook: () => void;
  readonly onToggleHookEnabled: (hook: AutomationHook) => void;
  readonly onDeleteHook: (hookId: string) => void;
}

function SchedulesTabAutomationHooksCardContent({
  formState,
  workflows,
  hooks,
  hooksLoading,
  createPending,
  updatePending,
  deletePending,
  onFormStateChange,
  onCreateHook,
  onToggleHookEnabled,
  onDeleteHook,
}: Readonly<AutomationHooksCardContentProps>) {
  return (
    <CardContent className="space-y-4">
      <AutomationHookForm
        state={formState}
        workflows={workflows}
        onTriggerTypeChange={(value) =>
          onFormStateChange((current) => ({ ...current, triggerType: value }))
        }
        onActionTypeChange={(value) =>
          onFormStateChange((current) => ({ ...current, actionType: value }))
        }
        onWorkflowIdChange={(value) =>
          onFormStateChange((current) => ({ ...current, workflowId: value }))
        }
        onEventNameChange={(value) =>
          onFormStateChange((current) => ({ ...current, eventName: value }))
        }
        onPriorityTextChange={(value) =>
          onFormStateChange((current) => ({ ...current, priorityText: value }))
        }
        onCooldownTextChange={(value) =>
          onFormStateChange((current) => ({ ...current, cooldownText: value }))
        }
        onEnabledChange={(value) =>
          onFormStateChange((current) => ({ ...current, enabled: value }))
        }
        onTriggerFilterTextChange={(value) =>
          onFormStateChange((current) => ({
            ...current,
            triggerFilterText: value,
          }))
        }
        onPayloadTextChange={(value) =>
          onFormStateChange((current) => ({ ...current, payloadText: value }))
        }
      />

      <Button onClick={onCreateHook} disabled={createPending}>
        {createPending ? "Saving..." : "Add Hook"}
      </Button>

      <AutomationHooksList
        hooks={hooks}
        isLoading={hooksLoading}
        updatePending={updatePending}
        deletePending={deletePending}
        onToggleEnabled={onToggleHookEnabled}
        onDelete={onDeleteHook}
      />
    </CardContent>
  );
}

export function SchedulesTabAutomationHooksCard({
  projectId,
  workflows,
}: Readonly<SchedulesTabAutomationHooksCardProps>) {
  const toast = useToast();
  const hooksQuery = useAutomationHooks(projectId);
  const createHook = useCreateAutomationHook(projectId);
  const updateHook = useUpdateAutomationHook(projectId);
  const deleteHook = useDeleteAutomationHook(projectId);

  const defaultWorkflowId = useMemo(() => workflows[0]?.id ?? "", [workflows]);
  const [formState, setFormState] = useState<AutomationHookFormState>(() =>
    buildInitialFormState(defaultWorkflowId),
  );

  useEffect(() => {
    if (formState.workflowId || defaultWorkflowId.length === 0) {
      return;
    }

    setFormState((current) => ({ ...current, workflowId: defaultWorkflowId }));
  }, [defaultWorkflowId, formState.workflowId]);

  const parseJsonField = (
    label: string,
    text: string,
  ): Record<string, unknown> | undefined => {
    try {
      return parseSchedulePayloadJson(text);
    } catch (error) {
      toast.error(
        `${label} must be valid JSON`,
        getApiErrorMessage(error, "Expected a JSON object."),
      );
      return undefined;
    }
  };

  const buildActionPayload = (): Record<string, unknown> | null => {
    const payloadObject = parseJsonField(
      "Action payload",
      formState.payloadText,
    );
    if (
      formState.payloadText.trim().length > 0 &&
      payloadObject === undefined
    ) {
      return null;
    }

    if (formState.actionType === "invoke_workflow") {
      if (!formState.workflowId) {
        toast.error("Workflow required", "Select a workflow for this hook.");
        return null;
      }

      return {
        workflow_id: formState.workflowId,
        ...(payloadObject ? { payload: payloadObject } : {}),
      };
    }

    if (formState.actionType === "emit_event") {
      const trimmedEventName = formState.eventName.trim();
      if (!trimmedEventName) {
        toast.error("Event name required", "Provide an event name to emit.");
        return null;
      }

      return {
        event_name: trimmedEventName,
        ...(payloadObject ? { payload: payloadObject } : {}),
      };
    }

    return payloadObject ?? {};
  };

  const handleCreateHook = async () => {
    const parsedPriority = Number.parseInt(formState.priorityText, 10);
    const parsedCooldown = Number.parseInt(formState.cooldownText, 10);

    if (!Number.isFinite(parsedPriority) || parsedPriority < 0) {
      toast.error(
        "Invalid priority",
        "Priority must be a non-negative integer.",
      );
      return;
    }

    if (!Number.isFinite(parsedCooldown) || parsedCooldown < 0) {
      toast.error(
        "Invalid cooldown",
        "Cooldown must be a non-negative integer in seconds.",
      );
      return;
    }

    const triggerFilter = parseJsonField(
      "Trigger filter",
      formState.triggerFilterText,
    );
    if (
      formState.triggerFilterText.trim().length > 0 &&
      triggerFilter === undefined
    ) {
      return;
    }

    const actionPayload = buildActionPayload();
    if (!actionPayload) {
      return;
    }

    try {
      await createHook.mutateAsync({
        enabled: formState.enabled,
        trigger_type: formState.triggerType,
        trigger_filter: triggerFilter,
        priority: parsedPriority,
        action_type: formState.actionType,
        action_payload: actionPayload,
        cooldown_window_seconds: parsedCooldown,
      });
      toast.success("Hook created", "Automation hook is now active.");
      setFormState(buildInitialFormState(workflows[0]?.id ?? ""));
    } catch (error) {
      toast.error(
        "Failed to create hook",
        getApiErrorMessage(error, "Unable to save automation hook."),
      );
    }
  };

  const toggleHookEnabled = async (hook: AutomationHook) => {
    try {
      await updateHook.mutateAsync({
        id: hook.id,
        data: { enabled: !hook.enabled },
      });
      toast.info(
        hook.enabled ? "Hook paused" : "Hook enabled",
        hook.enabled
          ? "This hook will no longer fire."
          : "This hook is ready to trigger.",
      );
    } catch (error) {
      toast.error(
        "Failed to update hook",
        getApiErrorMessage(error, "Unable to update hook state."),
      );
    }
  };

  const removeHook = async (hookId: string) => {
    try {
      await deleteHook.mutateAsync(hookId);
      toast.info("Hook deleted", "Automation hook removed.");
    } catch (error) {
      toast.error(
        "Failed to delete hook",
        getApiErrorMessage(error, "Unable to delete automation hook."),
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle Hooks</CardTitle>
      </CardHeader>

      <SchedulesTabAutomationHooksCardContent
        formState={formState}
        workflows={workflows}
        hooks={hooksQuery.data?.items ?? []}
        hooksLoading={hooksQuery.isLoading}
        createPending={createHook.isPending}
        updatePending={updateHook.isPending}
        deletePending={deleteHook.isPending}
        onFormStateChange={(updater) => {
          setFormState((current) => updater(current));
        }}
        onCreateHook={() => {
          void handleCreateHook();
        }}
        onToggleHookEnabled={(hook) => {
          void toggleHookEnabled(hook);
        }}
        onDeleteHook={(hookId) => {
          void removeHook(hookId);
        }}
      />
    </Card>
  );
}
