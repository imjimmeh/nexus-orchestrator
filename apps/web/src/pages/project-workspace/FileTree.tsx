import { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface FileTreeProps {
  readonly files: string[];
  readonly selectedPath: string | null;
  readonly onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children: TreeNode[];
}

function buildFileTree(files: string[]): TreeNode {
  const root: TreeNode = {
    name: "",
    path: "",
    type: "directory",
    children: [],
  };

  files.forEach((filePath) => {
    const parts = filePath.split("/");
    let current = root;

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      const currentPath = parts.slice(0, index + 1).join("/");

      const existing = current.children.find((child) => child.name === part);
      if (existing) {
        current = existing;
      } else {
        const newNode: TreeNode = {
          name: part,
          path: currentPath,
          type: isLast ? "file" : "directory",
          children: [],
        };
        current.children.push(newNode);
        current = newNode;
      }
    });
  });

  // Sort: directories first, then alphabetically
  const sortNodes = (node: TreeNode): void => {
    node.children.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }
      return a.type === "directory" ? -1 : 1;
    });
    node.children.forEach(sortNodes);
  };
  sortNodes(root);

  return root;
}

function TreeNodeItem({
  node,
  selectedPath,
  onSelectFile,
  depth = 0,
}: {
  node: TreeNode;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  depth?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const isSelected = node.path === selectedPath;

  if (node.type === "file") {
    return (
      <div
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent",
          isSelected && "bg-accent",
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => onSelectFile(node.path)}
      >
        <File className="h-4 w-4 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        {isExpanded ? (
          <FolderOpen className="h-4 w-4 text-primary" />
        ) : (
          <Folder className="h-4 w-4 text-primary" />
        )}
        <span className="truncate font-medium">
          {node.name || "Repository"}
        </span>
      </div>
      {isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ files, selectedPath, onSelectFile }: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className="h-full overflow-auto border-r p-2">
      <TreeNodeItem
        node={tree}
        selectedPath={selectedPath}
        onSelectFile={onSelectFile}
      />
    </div>
  );
}
