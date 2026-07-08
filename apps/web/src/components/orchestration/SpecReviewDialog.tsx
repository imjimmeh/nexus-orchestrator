import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api/client";
import { WorkflowWorkspaceTreeNode } from "@/lib/api/workflows.types";

interface SpecReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowRunId: string;
}

type SpecTab = "prd" | "sdd" | "diff";

function matchSpecFile(
  node: WorkflowWorkspaceTreeNode,
  _fullPath: string,
): { prd: boolean; sdd: boolean } {
  const lower = node.name.toLowerCase();
  const isMarkdown = node.type === "file" && lower.endsWith(".md");
  return {
    prd: isMarkdown && lower.includes("prd"),
    sdd: isMarkdown && lower.includes("sdd"),
  };
}

function findSpecFiles(
  nodes: WorkflowWorkspaceTreeNode[],
  prefix = "",
): { prdPath: string | null; sddPath: string | null } {
  let prdPath: string | null = null;
  let sddPath: string | null = null;

  for (const node of nodes) {
    const fullPath = prefix ? `${prefix}/${node.name}` : node.name;
    const match = matchSpecFile(node, fullPath);

    if (!prdPath && match.prd) prdPath = fullPath;
    if (!sddPath && match.sdd) sddPath = fullPath;

    if (node.type === "directory" && node.children) {
      const child = findSpecFiles(node.children, fullPath);
      prdPath = prdPath ?? child.prdPath;
      sddPath = sddPath ?? child.sddPath;
    }
  }

  return { prdPath, sddPath };
}

function resolveActiveFilePath(
  tab: SpecTab,
  specFiles: { prdPath: string | null; sddPath: string | null },
): string | null {
  if (tab === "prd") return specFiles.prdPath;
  if (tab === "sdd") return specFiles.sddPath;
  return null;
}

function SpecContentArea({
  isLoading,
  error,
  content,
  activeTab,
}: Readonly<{
  isLoading: boolean;
  error: unknown;
  content: string | null;
  activeTab: SpecTab;
}>) {
  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Loading workspace files...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load file content. The workspace may no longer be available.
      </div>
    );
  }

  if (content) {
    return (
      <pre className="whitespace-pre-wrap p-4 text-sm leading-relaxed">
        {content}
      </pre>
    );
  }

  const emptyMessage =
    activeTab === "diff"
      ? "No changes detected."
      : "File not found in workspace.";

  return (
    <div className="flex h-40 items-center justify-center">
      <p className="text-sm text-muted-foreground">{emptyMessage}</p>
    </div>
  );
}

function SpecTabButton({
  label,
  tab,
  activeTab,
  disabled,
  onClick,
}: Readonly<{
  label: string;
  tab: SpecTab;
  activeTab: SpecTab;
  disabled: boolean;
  onClick: (tab: SpecTab) => void;
}>) {
  return (
    <Button
      size="sm"
      variant={activeTab === tab ? "default" : "outline"}
      onClick={() => onClick(tab)}
      disabled={disabled}
    >
      {label}
      {disabled ? (
        <Badge variant="outline" className="ml-1 text-xs">
          not found
        </Badge>
      ) : null}
    </Button>
  );
}

function useSpecContent(
  open: boolean,
  workflowRunId: string,
  activeTab: SpecTab,
  activeFilePath: string | null,
) {
  const {
    data: fileData,
    isLoading: isFileLoading,
    error: fileError,
  } = useQuery({
    queryKey: ["spec-review-file", workflowRunId, activeFilePath],
    queryFn: () =>
      api.getWorkflowRunWorkspaceFileContent(
        workflowRunId,
        activeFilePath ?? "",
      ),
    enabled: open && !!workflowRunId && !!activeFilePath,
  });

  const {
    data: diffData,
    isLoading: isDiffLoading,
    error: diffError,
  } = useQuery({
    queryKey: ["spec-review-diff", workflowRunId],
    queryFn: () => api.getWorkflowRunWorkspaceDiff(workflowRunId),
    enabled: open && !!workflowRunId && activeTab === "diff",
  });

  const isDiff = activeTab === "diff";
  return {
    isLoading: isDiff ? isDiffLoading : isFileLoading,
    error: isDiff ? diffError : fileError,
    content: isDiff ? (diffData?.diff ?? null) : (fileData?.content ?? null),
  };
}

export function SpecReviewDialog({
  open,
  onOpenChange,
  workflowRunId,
}: Readonly<SpecReviewDialogProps>) {
  const [activeTab, setActiveTab] = useState<SpecTab>("prd");

  const { data: tree = [], isLoading: isTreeLoading } = useQuery({
    queryKey: ["spec-review-tree", workflowRunId],
    queryFn: () => api.getWorkflowRunWorkspaceTree(workflowRunId),
    enabled: open && !!workflowRunId,
  });

  const specFiles = findSpecFiles(tree);
  const activeFilePath = resolveActiveFilePath(activeTab, specFiles);
  const {
    isLoading: isContentLoading,
    error,
    content,
  } = useSpecContent(open, workflowRunId, activeTab, activeFilePath);
  const isLoading = isTreeLoading || isContentLoading;

  const handleTabClick = useCallback((tab: SpecTab) => {
    setActiveTab(tab);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>Specification Review</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b pb-2">
          <SpecTabButton
            label="PRD"
            tab="prd"
            activeTab={activeTab}
            disabled={!specFiles.prdPath && !isTreeLoading}
            onClick={handleTabClick}
          />
          <SpecTabButton
            label="SDD"
            tab="sdd"
            activeTab={activeTab}
            disabled={!specFiles.sddPath && !isTreeLoading}
            onClick={handleTabClick}
          />
          <SpecTabButton
            label="Git Diff"
            tab="diff"
            activeTab={activeTab}
            disabled={false}
            onClick={handleTabClick}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded border bg-muted/30">
          <SpecContentArea
            isLoading={isLoading}
            error={error}
            content={content}
            activeTab={activeTab}
          />
        </div>

        {activeFilePath && !isLoading && !error ? (
          <p className="text-xs text-muted-foreground">
            Showing: {activeFilePath}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
