export interface StartupRoutingSourceContext {
  sourceType: string;
  sourceId: string;
  metadata?: Record<string, unknown>;
}

export interface StartupRoutingReadinessContext {
  isReady: boolean;
  readinessReason?: string;
  lastCheckedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface StartupRoutingHints {
  preferredWorkflowId?: string;
  preferredRouteId?: string;
  skipRouteArbitration?: boolean;
  metadata?: Record<string, unknown>;
}

export interface StartupRoutingContext {
  scopeId: string;
  goals: string;
  sourceContext?: StartupRoutingSourceContext;
  readinessContext?: StartupRoutingReadinessContext;
  startupHints?: StartupRoutingHints;
}

export interface StartupRoutingDecision {
  routeId: string;
  ruleId: string;
  workflowId: string;
  reasoning?: string;
  inputs?: Record<string, unknown>;
}
