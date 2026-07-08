// packages/e2e-tests/src/fake-llm/types.ts
export type Protocol = "openai" | "anthropic";

export type CanonicalRole = "system" | "user" | "assistant" | "tool";

export interface CanonicalToolDef {
  name: string;
  description: string;
}

export interface CanonicalMessage {
  role: CanonicalRole;
  text: string;
  /** For tool-result messages: the tool whose output this message carries. */
  toolName?: string;
}

export interface CanonicalRequest {
  protocol: Protocol;
  model: string;
  /** Flattened system prompt text ('' when none). */
  system: string;
  messages: CanonicalMessage[];
  tools: CanonicalToolDef[];
  stream: boolean;
  rawBody: unknown;
  headers: Record<string, string>;
}

export interface TextTurn {
  kind: "text";
  text: string;
}

export interface ToolCallTurn {
  kind: "tool_call";
  toolName: string;
  arguments: Record<string, unknown>;
}

export type Turn = TextTurn | ToolCallTurn;

export interface RuleMatch {
  model?: string | RegExp;
  systemIncludes?: string;
  /** Matched against the last user message's text. */
  userIncludes?: string;
  /** A tool with this name is present in the request's tool list. */
  hasTool?: string;
  /** The request carries a tool-result produced by this tool. */
  toolResultFor?: string;
  /** Zero-based index of this request among all requests since reset(). */
  callIndex?: number;
}

export interface Rule {
  match: RuleMatch;
  respond: Turn[];
}

export interface Scenario {
  name: string;
  rules: Rule[];
}

export interface RecordedRequest extends CanonicalRequest {
  index: number;
}
