export interface PluginEventEnvelopeBase {
  topic: string;
  eventName: string;
  correlationId?: string;
  occurredAt: string;
}

export interface PluginEventScopeContext {
  scopeId?: string;
  contextId?: string;
}

export type PluginEventEnvelopePayload = Record<string, unknown>;

export interface PluginEventEnvelope
  extends PluginEventEnvelopeBase, PluginEventScopeContext {
  payload: PluginEventEnvelopePayload;
}

export interface WorkflowRunPluginEventPayload extends PluginEventScopeContext {
  runId: string;
  status: 'started' | 'completed' | 'failed';
  timestamp: string;
}

export interface WorkflowStepPluginEventPayload extends PluginEventScopeContext {
  runId: string;
  stepId: string;
  status: 'started' | 'completed' | 'failed';
  timestamp: string;
}

export interface ToolInvokedPluginEventPayload extends PluginEventScopeContext {
  toolName: string;
  invocationId: string;
  timestamp: string;
}

export interface MemoryRecordedPluginEventPayload extends PluginEventScopeContext {
  segmentId: string;
  timestamp: string;
}
