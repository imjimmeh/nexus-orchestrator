import type { ComponentType } from "react";
import type { ToolCallMetadata } from "../chat.types";

export interface ToolProps {
  toolCall: ToolCallMetadata;
}

export type ToolComponentType = ComponentType<Readonly<ToolProps>>;
