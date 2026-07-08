// apps/web/src/components/scope/ScopeTree.tsx
import { useMemo, useState } from "react";
import { useScopeTree } from "@/hooks/useScope";
import { useScopeContext } from "@/context/ScopeContext";
import { ScopeTreeNode } from "./ScopeTreeNode";
import { Input } from "@/components/ui/input";
import type { ScopeNode } from "@/lib/api/client.scope.types";

/**
 * Returns nodes that directly match the query, or whose descendants match.
 * Non-matching ancestor rows are suppressed; only directly-matching nodes
 * (and their subtrees) are included in the result.
 */
function filterNodes(nodes: ScopeNode[], query: string): ScopeNode[] {
  if (!query) return nodes;
  const result: ScopeNode[] = [];
  for (const node of nodes) {
    const directMatch = node.name.toLowerCase().includes(query.toLowerCase());
    const filteredChildren = filterNodes(node.children ?? [], query);
    if (directMatch) {
      result.push({ ...node, children: node.children ?? [] });
    } else if (filteredChildren.length > 0) {
      // Promote matching children up without their non-matching parent
      result.push(...filteredChildren);
    }
  }
  return result;
}

export function ScopeTree() {
  const { data: root, isLoading, isError } = useScopeTree();
  const { activeScopeNodeId, setActiveScopeNodeId, setScopePath } =
    useScopeContext();
  const [filter, setFilter] = useState("");

  const visibleNodes = useMemo(() => {
    if (!root) return [];
    return filterNodes([root], filter);
  }, [root, filter]);

  const handleSelect = (node: ScopeNode, path: string[]) => {
    setActiveScopeNodeId(node.id);
    setScopePath(path);
  };

  if (isLoading)
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">Loading...</p>
    );
  if (isError) {
    return (
      <p className="px-3 py-2 text-sm text-destructive">
        Failed to load scopes.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="Filter nodes..."
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
        }}
        className="h-7 text-xs"
      />
      <div className="overflow-y-auto">
        {visibleNodes.map((node) => (
          <ScopeTreeNode
            key={node.id}
            node={node}
            depth={0}
            activeScopeNodeId={activeScopeNodeId}
            onSelect={handleSelect}
            ancestorPath={[]}
          />
        ))}
      </div>
    </div>
  );
}
