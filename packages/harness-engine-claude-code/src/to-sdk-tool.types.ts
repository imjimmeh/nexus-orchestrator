// packages/harness-engine-claude-code/src/to-sdk-tool.types.ts

export interface SdkTool {
  name: string;
  description: string;
  parameters: unknown;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ToSdkToolOptions {
  /**
   * Invoked when a tool result requests turn termination (a durable-await
   * suspend directive, `terminate: true`). The engine uses this to abort the
   * in-flight SDK query and mark the session suspended. See kanban-atuq.
   */
  onTerminate?: () => void;
}
