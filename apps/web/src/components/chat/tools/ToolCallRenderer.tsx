import { resolveTool } from "./registry";
import type { ToolProps } from "./registry";

export function ToolCallRenderer({ toolCall }: Readonly<ToolProps>) {
  const Comp = resolveTool(toolCall.toolName);
  return <Comp toolCall={toolCall} />;
}
