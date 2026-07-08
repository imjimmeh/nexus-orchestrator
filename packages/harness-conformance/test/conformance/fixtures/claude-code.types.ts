// ---------------------------------------------------------------------------
// SDK message shapes (mirrors map-claude-event.ts internal types)
// ---------------------------------------------------------------------------

export interface SdkAssistantMessage {
  type: "assistant";
  message: {
    content: Array<
      | {
          type: "tool_use";
          id: string;
          name: string;
          input: Record<string, unknown>;
        }
      | { type: string }
    >;
  };
}

export interface SdkUserMessage {
  type: "user";
  message: {
    content: Array<
      | {
          type: "tool_result";
          tool_use_id: string;
          content: unknown;
          is_error?: boolean;
        }
      | { type: string }
    >;
  };
}

export interface SdkResultMessage {
  type: "result";
  subtype: string;
  result: string;
  usage?: { output_tokens?: number };
}

export type SdkMessage =
  | SdkAssistantMessage
  | SdkUserMessage
  | SdkResultMessage;
