// packages/harness-runtime/src/tools/mounted-tools.types.ts

/**
 * Handler for runner-local tools (e.g. browser automation).
 * Injected by the caller so this module stays platform-agnostic.
 */
export type RunnerLocalToolHandler = (
  toolName: string,
  params: Record<string, unknown>,
  apiContext?: {
    workflowRunId?: string;
  },
) => Promise<unknown>;
