import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/** Result of converting kernel-governed tools to PI ToolDefinitions. */
export interface GovernedToolConversionResult {
  piTools: ToolDefinition[];
  sanitizedToOriginal: Map<string, string>;
}
