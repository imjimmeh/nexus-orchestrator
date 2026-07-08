import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { WorkflowWorkspaceTreeNode } from "@/lib/api/workflows.types";

export function TerminalPanel({ chunks }: Readonly<{ chunks: string[] }>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cursorRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      convertEol: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      cursorRef.current = 0;
    };
  }, []);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    for (let index = cursorRef.current; index < chunks.length; index += 1) {
      terminalRef.current.write(chunks[index] || "");
    }

    cursorRef.current = chunks.length;
  }, [chunks]);

  return (
    <div
      ref={containerRef}
      className="h-[56vh] w-full rounded border bg-black/95"
    />
  );
}

export function DiffPanel({
  diff,
  isLoading,
  error,
}: Readonly<{ diff: string; isLoading: boolean; error: string | null }>) {
  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading workspace diff...</p>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!diff.trim()) {
    return (
      <p className="text-sm text-muted-foreground">No workspace changes yet.</p>
    );
  }

  return (
    <pre className="h-[56vh] overflow-auto rounded border bg-muted/20 p-3 text-xs">
      {diff}
    </pre>
  );
}

function FileTreeNode({
  node,
  level,
}: Readonly<{ node: WorkflowWorkspaceTreeNode; level: number }>) {
  const paddingLeft = level * 12;

  if (node.type === "file") {
    return (
      <li className="text-sm" style={{ paddingLeft }}>
        <span className="text-muted-foreground">📄</span> {node.name}
      </li>
    );
  }

  return (
    <li className="text-sm" style={{ paddingLeft }}>
      <div>
        <span className="text-muted-foreground">📁</span> {node.name}
      </div>
      {node.children && node.children.length > 0 && (
        <ul className="space-y-1">
          {node.children.map((child) => (
            <FileTreeNode key={child.path} node={child} level={level + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTreePanel({
  nodes,
  isLoading,
  error,
}: Readonly<{
  nodes: WorkflowWorkspaceTreeNode[];
  isLoading: boolean;
  error: string | null;
}>) {
  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading workspace tree...</p>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (nodes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Workspace is empty or unavailable.
      </p>
    );
  }

  return (
    <div className="h-[56vh] overflow-auto rounded border bg-muted/20 p-3">
      <ul className="space-y-1">
        {nodes.map((node) => (
          <FileTreeNode key={node.path} node={node} level={0} />
        ))}
      </ul>
    </div>
  );
}
