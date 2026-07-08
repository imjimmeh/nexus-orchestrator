// apps/web/src/components/scope/ScopeNodePicker.tsx
import { useState, useMemo } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useScopeTree } from "@/hooks/useScope";
import type { ScopeNode } from "@/lib/api/client.scope.types";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";

interface FlatNode {
  id: string;
  label: string; // indented display name
  name: string;
}

function flattenTree(node: ScopeNode, depth: number): FlatNode[] {
  const indent = "  ".repeat(depth);
  const self: FlatNode = {
    id: node.id,
    label: `${indent}${node.name}`,
    name: node.name,
  };
  return [
    self,
    ...(node.children ?? []).flatMap((c) => flattenTree(c, depth + 1)),
  ];
}

interface ScopeNodePickerProps {
  value?: string;
  onChange: (scopeNodeId: string) => void;
  placeholder?: string;
  includeGlobal?: boolean;
}

export function ScopeNodePicker({
  value,
  onChange,
  placeholder = "Select scope...",
  includeGlobal = true,
}: ScopeNodePickerProps) {
  const [open, setOpen] = useState(false);
  const { data: root } = useScopeTree();

  const nodes = useMemo<FlatNode[]>(() => {
    if (!root) return [];
    const all = flattenTree(root, 0);
    return includeGlobal
      ? all
      : all.filter((n) => n.id !== GLOBAL_SCOPE_NODE_ID);
  }, [root, includeGlobal]);

  const selected = nodes.find((n) => n.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
        >
          {selected ? selected.name : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Search scopes..." />
          <CommandList>
            <CommandEmpty>No scope found.</CommandEmpty>
            <CommandGroup>
              {nodes.map((node) => (
                <CommandItem
                  key={node.id}
                  value={`${node.label} ${node.id}`}
                  onSelect={() => {
                    onChange(node.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === node.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="font-mono text-sm">{node.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
