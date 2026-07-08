export async function storeTelemetryAgentResponse(params: {
  client: {
    workflowRunId?: string;
    stepId?: string;
  };
  payload: Record<string, unknown>;
  failureMessage?: string;
  errorPrefix: string;
  emptySentinel: string;
  storeResponse: (
    workflowRunId: string,
    stepId: string,
    response: string,
  ) => Promise<void>;
  storeStepComplete?: (
    workflowRunId: string,
    stepId: string,
    response: string,
  ) => Promise<void>;
}): Promise<void> {
  const { client } = params;
  const responseToStore = buildAgentResponseToStore(
    params.payload,
    params.failureMessage,
    params.errorPrefix,
    params.emptySentinel,
  );

  if (responseToStore && client.workflowRunId && client.stepId) {
    await storeTurnEndResponseBestEffort({
      workflowRunId: client.workflowRunId,
      stepId: client.stepId,
      responseToStore,
      storeResponse: params.storeResponse,
      storeStepComplete: params.storeStepComplete,
    });
  }
}

function buildAgentResponseToStore(
  payload: Record<string, unknown>,
  failureMessage: string | undefined,
  errorPrefix: string,
  emptySentinel: string,
): string {
  const output = payload.output as Record<string, unknown> | undefined;
  const response =
    typeof output?.response === 'string' ? output.response.trim() : '';
  if (response) {
    return response;
  }

  const outputErrorMessage =
    typeof output?.errorMessage === 'string' ? output.errorMessage.trim() : '';
  const errorMessage = failureMessage?.trim() ?? outputErrorMessage;
  return errorMessage ? `${errorPrefix}${errorMessage}` : emptySentinel;
}

async function storeTurnEndResponseBestEffort(params: {
  workflowRunId: string;
  stepId: string;
  responseToStore: string;
  storeResponse: (
    workflowRunId: string,
    stepId: string,
    response: string,
  ) => Promise<void>;
  storeStepComplete?: (
    workflowRunId: string,
    stepId: string,
    response: string,
  ) => Promise<void>;
}): Promise<void> {
  try {
    await params.storeResponse(
      params.workflowRunId,
      params.stepId,
      params.responseToStore,
    );
    if (params.storeStepComplete) {
      await params.storeStepComplete(
        params.workflowRunId,
        params.stepId,
        params.responseToStore,
      );
    }
  } catch {
    // best-effort response capture
  }
}
