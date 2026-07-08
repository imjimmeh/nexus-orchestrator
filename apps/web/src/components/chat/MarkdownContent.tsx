import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

const MARKDOWN_COMPONENTS: React.ComponentProps<
  typeof ReactMarkdown
>["components"] = {
  p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-1 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-1 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  h1: ({ children }) => <h1 className="mb-1 font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-0.5 font-medium">{children}</h3>,
  pre: ({ children }) => (
    <pre className="mb-1 overflow-x-auto rounded bg-muted/60 p-2 text-xs">
      {children}
    </pre>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted/60 px-1 py-0.5 text-xs font-mono">
        {children}
      </code>
    ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-muted-foreground/30 pl-2 text-muted-foreground">
      {children}
    </blockquote>
  ),
};

type ContentSegment =
  | { kind: "text"; value: string }
  | { kind: "think"; value: string };

function parseContentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const regex = /<think>([\s\S]*?)<\/think>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        kind: "text",
        value: content.slice(lastIndex, match.index).trim(),
      });
    }
    segments.push({ kind: "think", value: match[1].trim() });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    const tail = content.slice(lastIndex).trim();
    if (tail) {
      segments.push({ kind: "text", value: tail });
    }
  }

  return segments.filter((s) => s.value.length > 0);
}

function ThinkBlock({ content }: Readonly<{ content: string }>) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 rounded border border-amber-400/40 bg-amber-50/60">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-amber-700 hover:bg-amber-100/60"
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <p className="font-medium">{open ? "▾" : "▸"} Thinking</p>
        {!open && (
          <p className="truncate text-amber-600/70">{content.split("\n")[0]}</p>
        )}
      </button>
      {open && (
        <div className="border-t border-amber-400/30 px-2 py-1.5 text-xs italic text-amber-800/80 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

export function MarkdownWithThinkBlocks({
  content,
}: Readonly<{ content: string }>) {
  const segments = useMemo(() => parseContentSegments(content), [content]);

  if (segments.length === 0) {
    return null;
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "think" ? (
          <ThinkBlock key={i} content={seg.value} />
        ) : (
          <div key={i}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={MARKDOWN_COMPONENTS}
            >
              {seg.value}
            </ReactMarkdown>
          </div>
        ),
      )}
    </>
  );
}
