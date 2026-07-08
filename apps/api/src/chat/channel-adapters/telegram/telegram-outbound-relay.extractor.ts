function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  return asRecord(parent[key]);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function collectResponsesFromOutput(output: Record<string, unknown>): string[] {
  const responses: string[] = [];

  const directResponse = readNonEmptyString(output.response);
  if (directResponse) {
    responses.push(directResponse);
  }

  const outputsByStep = readRecord(output, 'outputs');
  if (!outputsByStep) {
    return responses;
  }

  const finalStepId = readNonEmptyString(output.finalStepId);
  if (finalStepId) {
    const finalStepOutput = readRecord(outputsByStep, finalStepId);
    const finalStepResponse = readNonEmptyString(finalStepOutput?.response);
    if (finalStepResponse) {
      responses.push(finalStepResponse);
    }
  }

  for (const stepOutput of Object.values(outputsByStep)) {
    const stepOutputRecord = asRecord(stepOutput);
    const stepResponse = readNonEmptyString(stepOutputRecord?.response);
    if (stepResponse) {
      responses.push(stepResponse);
    }
  }

  return responses;
}

function collectResponsesFromJobState(jobState: unknown): string[] {
  const jobRecord = asRecord(jobState);
  if (!jobRecord) {
    return [];
  }

  const output = readRecord(jobRecord, 'output');
  if (!output) {
    return [];
  }

  return collectResponsesFromOutput(output);
}

function readJobsState(
  runDetails: Record<string, unknown>,
): Record<string, unknown> | null {
  const stateVariables =
    readRecord(runDetails, 'state_variables') ??
    readRecord(runDetails, 'stateVariables');
  if (!stateVariables) {
    return null;
  }

  return readRecord(stateVariables, 'jobs');
}

export function extractAssistantResponseFromRunDetails(
  runDetails: Record<string, unknown>,
): string | null {
  const jobs = readJobsState(runDetails);
  if (!jobs) {
    return null;
  }

  const responses = Object.values(jobs).flatMap((jobState) =>
    collectResponsesFromJobState(jobState),
  );
  return responses.length > 0 ? responses[responses.length - 1] : null;
}

export function sanitizeTelegramAssistantResponse(response: string): string {
  const withoutThinkingTags = response.replace(
    /<thinking>[\s\S]*?<\/thinking>/giu,
    '',
  );
  const withoutReasoningBlocks = withoutThinkingTags.replace(
    /```(?:thinking|reasoning|analysis|scratchpad)[\s\S]*?```/giu,
    '',
  );

  return withoutReasoningBlocks.replace(/\n{3,}/gu, '\n\n').trim();
}
