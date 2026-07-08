import type { ToolCallMetadata } from "../chat.types";
import { ToolCallRenderer } from "../tools/ToolCallRenderer";

/**
 * Renders a structured tool-call metadata payload via the shared
 * `ToolCallRenderer` so the same tool-specific UI is used everywhere.
 */
export function ToolCallMessagePart({
  toolCall,
}: Readonly<{ toolCall: ToolCallMetadata }>) {
  return <ToolCallRenderer toolCall={toolCall} />;
}