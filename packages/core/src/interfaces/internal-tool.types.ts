import type { ZodType } from "zod";

export interface RuntimeCapabilityApiCallbackDefinition {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathTemplate: string;
  bodyMapping?: Record<string, string>;
}

export interface RuntimeCapabilityModeBehavior {
  autonomous?: "allow" | "deny" | "require_approval";
  supervised?: "allow" | "deny" | "require_approval";
  notifications_only?: "allow" | "deny" | "require_approval";
}

export interface RuntimeCapabilityDefinition<
  TSchema extends ZodType = ZodType,
> {
  name: string;
  tierRestriction: number;
  transport:
    | "api_callback"
    | "mounted_tool"
    | "runner_local"
    | "websocket_bridge";
  runtimeOwner: "api" | "runner";
  policyTags?: string[];
  description?: string;
  apiCallback?: RuntimeCapabilityApiCallbackDefinition;
  bridgeAction?: string;
  mutatingAction?: string;
  modeBehavior?: RuntimeCapabilityModeBehavior;
  seedInRegistry?: boolean;
  inputSchema: TSchema;
  typescriptCode?: string;
}

export interface InternalToolExecutionContext {
  workflowRunId?: string;
  jobId?: string;
  scopeId?: string | null;
  userId?: string;
  userRoles?: string[];
  agentProfileName?: string;
}

export interface IInternalToolHandler<
  TParams = unknown,
  TResult = Record<string, unknown>,
> {
  getName(): string;
  getDefinition(): RuntimeCapabilityDefinition;
  execute(
    context: InternalToolExecutionContext,
    params: TParams,
  ): Promise<TResult>;
}
