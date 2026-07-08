/**
 * Normalized view of a tool result. Tool results arrive from the harness in the
 * Anthropic content-block envelope (`{ content: [{ type: "text", text }] }`),
 * sometimes double-wrapped, and the inner text is frequently a JSON string.
 * Normalizing collapses those layers into a single text or structured value.
 */
export type NormalizedToolContent =
  | { kind: "text"; text: string }
  | { kind: "json"; value: unknown }
  | { kind: "empty" };
