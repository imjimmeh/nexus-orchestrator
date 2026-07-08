import { z } from "zod";
import { ExecutionContextSchema } from "../schemas/execution-context.schema";

export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

export function createExecutionContext(
  partial: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    scopeId: partial.scopeId ?? null,
    contextId: partial.contextId ?? null,
    contextType: partial.contextType ?? null,
    metadata: partial.metadata ?? null,
    scopeNodeId: partial.scopeNodeId ?? null,
    scopePath: partial.scopePath ?? null,
  };
}

export function getScopeId(
  context: ExecutionContext | null | undefined,
): string | null {
  return context?.scopeId ?? null;
}

export function getContextId(
  context: ExecutionContext | null | undefined,
): string | null {
  return context?.contextId ?? null;
}
