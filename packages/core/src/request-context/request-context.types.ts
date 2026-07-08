export interface RequestContext {
  requestId: string;
  causationId?: string;
  userId?: string;
  workflowRunId?: string;
  stepId?: string;
}

export interface CorrelationIdRequest {
  headers: Record<string, string | string[] | undefined>;
}

export interface CorrelationIdResponse {
  setHeader(name: string, value: string): unknown;
}

export interface CorrelationIdNextFunction {
  (): void;
}
