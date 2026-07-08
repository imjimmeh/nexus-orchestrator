import { useCallback, useEffect, useMemo, useState } from "react";
import type { HeartbeatFormSetters } from "./useSchedulesTabHeartbeatCard.types";
import {
  buildInitialHeartbeatFormState,
  type HeartbeatFormState,
} from "./SchedulesTabHeartbeatCard.shared";
import type {
  UseHeartbeatProfileFormParams,
  UseHeartbeatProfileFormResult,
} from "./useHeartbeatProfileForm.types";

export function useHeartbeatProfileForm({
  workflows,
}: Readonly<UseHeartbeatProfileFormParams>): UseHeartbeatProfileFormResult {
  const defaultWorkflowId = useMemo(
    () => workflows[0]?.id ?? "",
    [workflows],
  );
  const [form, setForm] = useState<HeartbeatFormState>(() =>
    buildInitialHeartbeatFormState(defaultWorkflowId),
  );

  useEffect(() => {
    if (form.workflowId || defaultWorkflowId.length === 0) {
      return;
    }

    setForm((current) => ({ ...current, workflowId: defaultWorkflowId }));
  }, [defaultWorkflowId, form.workflowId]);

  const resetForm = useCallback(() => {
    setForm(buildInitialHeartbeatFormState(workflows[0]?.id ?? ""));
  }, [workflows]);

  const setters = useMemo<HeartbeatFormSetters>(
    () => ({
      setName: (value) => {
        setForm((current) => ({ ...current, name: value }));
      },
      setIntervalSecondsText: (value) => {
        setForm((current) => ({ ...current, intervalSecondsText: value }));
      },
      setWorkflowId: (value) => {
        setForm((current) => ({ ...current, workflowId: value }));
      },
      setPayloadText: (value) => {
        setForm((current) => ({ ...current, payloadText: value }));
      },
      setEnabled: (value) => {
        setForm((current) => ({ ...current, enabled: value }));
      },
      resetForm,
    }),
    [resetForm],
  );

  return { form, setters, resetForm };
}
