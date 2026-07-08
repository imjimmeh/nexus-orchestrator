export type ToolResultContent = {
  type: "text";
  text: string;
};

export type ToolResult = {
  content: ToolResultContent[];
  isError?: boolean;
};

export type DiagnosticsSnapshot = {
  config: Record<string, unknown>;
  tools: string[];
  startupTime: string;
};
