import { MarkdownWithThinkBlocks } from "../MarkdownContent";

/**
 * Plain text message renderer. Wraps `MarkdownWithThinkBlocks` so that
 * `<think>…</think>` segments render as collapsible think blocks and the
 * remaining text is rendered as markdown.
 */
export function TextMessagePart({ content }: Readonly<{ content: string }>) {
  return <MarkdownWithThinkBlocks content={content} />;
}