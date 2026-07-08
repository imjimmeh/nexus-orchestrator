// apps/web/src/pages/scopes/tabs/ChildScopesTab.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateScopeNode } from "@/hooks/useScope";
import { useToast } from "@/hooks/useToast";
import type { ScopeNode, ScopeNodeType } from "@/lib/api/client.scope.types";

const NODE_TYPES: ScopeNodeType[] = ["org", "region", "team", "project"];

interface ChildScopesTabProps {
  parentNode: ScopeNode;
}

export function ChildScopesTab({ parentNode }: ChildScopesTabProps) {
  const navigate = useNavigate();
  const createScope = useCreateScopeNode();
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ScopeNodeType>("team");

  const children = parentNode.children ?? [];

  const handleCreate = async () => {
    try {
      const node = await createScope.mutateAsync({
        parentId: parentNode.id,
        type,
        name,
      });
      toast.success("Scope created", `${name} created.`);
      setDialogOpen(false);
      setName("");
      navigate(`/scopes/${node.id}`);
    } catch {
      toast.error("Error", "Failed to create scope.");
    }
  };

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Child Scopes</h3>
        <Button
          size="sm"
          onClick={() => {
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Child
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Members</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {children.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={4}
                className="text-center text-muted-foreground"
              >
                No child scopes.
              </TableCell>
            </TableRow>
          )}
          {children.map((child) => (
            <TableRow
              key={child.id}
              className="cursor-pointer hover:bg-accent/40"
              onClick={() => {
                navigate(`/scopes/${child.id}`);
              }}
            >
              <TableCell className="font-medium">{child.name}</TableCell>
              <TableCell>{child.type}</TableCell>
              <TableCell>—</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/scopes/${child.id}`);
                  }}
                >
                  Manage →
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Child Scope under {parentNode.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="scopeName">Name</Label>
              <Input
                id="scopeName"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder="e.g. Backend Team"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scopeType">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  setType(v as ScopeNodeType);
                }}
              >
                <SelectTrigger id="scopeType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NODE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleCreate();
              }}
              disabled={!name || createScope.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
