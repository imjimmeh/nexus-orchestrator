/** v3 token-usage block as written in pi-coding-agent session JSONL. */
export interface V3Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface V3TextBlock {
  type: "text";
  text: string;
}

export interface V3ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type V3ContentBlock = V3TextBlock | V3ToolCallBlock;

export interface V3UserMessage {
  role: "user";
  content: V3ContentBlock[];
}

export interface V3AssistantMessage {
  role: "assistant";
  content: V3ContentBlock[];
  provider?: string;
  model?: string;
  usage?: V3Usage;
  stopReason?: string;
  responseId?: string;
}

export interface V3ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: V3TextBlock[];
}

export type V3Message =
  | V3UserMessage
  | V3AssistantMessage
  | V3ToolResultMessage;

/**
 * A node payload WITHOUT the writer-owned envelope fields (`id`, `parentId`,
 * `timestamp`). The writer assigns those on append.
 */
export type V3NodePayload =
  | { type: "model_change"; provider: string; modelId: string }
  | { type: "message"; message: V3Message };

export interface V3WriterOptions {
  /** Generates node/session ids. Inject a deterministic counter in tests. */
  genId: () => string;
  /** Returns an ISO timestamp string. Inject a fixed clock in tests. */
  now: () => string;
}
