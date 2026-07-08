import { useState } from "react";
import { BudgetPolicy } from "@/lib/api/client.budget.types";
import {
  useBudgetPolicies,
  useCreateBudgetPolicy,
  useUpdateBudgetPolicy,
  useDisableBudgetPolicy,
} from "@/hooks/useBudgetPolicies";
import { useProviders } from "@/hooks/useProviders";
import { useModels } from "@/hooks/useModels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Ban } from "lucide-react";
import { PolicyForm } from "@/pages/admin/PolicyForm";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";

function formatLimitCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "-";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatWindow(window: string): string {
  return window.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface PolicyRowsProps {
  isLoading: boolean;
  policies: BudgetPolicy[];
  isGlobalScope: boolean;
  onEdit: (policy: BudgetPolicy) => void;
  onDisable: (policy: BudgetPolicy) => void;
}

function PolicyRows({
  isLoading,
  policies,
  isGlobalScope,
  onEdit,
  onDisable,
}: Readonly<PolicyRowsProps>) {
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="text-center">
          Loading...
        </TableCell>
      </TableRow>
    );
  }

  if (policies.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="text-center">
          No budget policies found
        </TableCell>
      </TableRow>
    );
  }

  return policies.map((policy) => (
    <TableRow key={policy.id}>
      <TableCell className="font-medium">{policy.name}</TableCell>
      <TableCell>
        {isGlobalScope ? "—" : <Badge variant="outline">◉ This scope</Badge>}
      </TableCell>
      <TableCell className="capitalize">
        {policy.scope_type.replace(/_/g, " ")}
      </TableCell>
      <TableCell className="capitalize">{policy.enforcement_mode}</TableCell>
      <TableCell>{formatWindow(policy.window)}</TableCell>
      <TableCell>{formatLimitCents(policy.soft_limit_cents)}</TableCell>
      <TableCell>{formatLimitCents(policy.hard_limit_cents)}</TableCell>
      <TableCell>
        <Badge variant={policy.is_active ? "default" : "secondary"}>
          {policy.is_active ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="icon" onClick={() => onEdit(policy)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDisable(policy)}
            disabled={!policy.is_active}
          >
            <Ban className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  ));
}

export function BudgetPoliciesTab() {
  const { activeScopeNodeId } = useScopeContext();
  const { data: policies = [], isLoading: policiesLoading } = useBudgetPolicies(
    { scopeNodeId: activeScopeNodeId },
  );
  const { data: providers = [] } = useProviders();
  const { data: models = [] } = useModels();

  const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;

  const createPolicy = useCreateBudgetPolicy();
  const updatePolicy = useUpdateBudgetPolicy();
  const disablePolicy = useDisableBudgetPolicy();

  const [editingPolicy, setEditingPolicy] = useState<BudgetPolicy | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [disablingPolicy, setDisablingPolicy] = useState<BudgetPolicy | null>(
    null,
  );

  const handleCreate = async (data: Record<string, unknown>) => {
    await createPolicy.mutateAsync(data as any);
    setIsCreateOpen(false);
  };

  const handleUpdate = async (data: Record<string, unknown>) => {
    if (!editingPolicy) return;
    await updatePolicy.mutateAsync({ id: editingPolicy.id, data: data as any });
    setIsEditOpen(false);
    setEditingPolicy(null);
  };

  const handleDisable = async () => {
    if (!disablingPolicy) return;
    await disablePolicy.mutateAsync(disablingPolicy.id);
    setDisablingPolicy(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Policy
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[700px]">
            <DialogHeader>
              <DialogTitle>Create Budget Policy</DialogTitle>
            </DialogHeader>
            <PolicyForm
              providers={providers}
              models={models}
              onSubmit={handleCreate}
              onCancel={() => setIsCreateOpen(false)}
              isSubmitting={createPolicy.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Scope Type</TableHead>
              <TableHead>Enforcement</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Soft Limit</TableHead>
              <TableHead>Hard Limit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <PolicyRows
              isLoading={policiesLoading}
              policies={policies}
              isGlobalScope={isGlobalScope}
              onEdit={(policy) => {
                setEditingPolicy(policy);
                setIsEditOpen(true);
              }}
              onDisable={setDisablingPolicy}
            />
          </TableBody>
        </Table>
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Edit Budget Policy</DialogTitle>
          </DialogHeader>
          {editingPolicy && (
            <PolicyForm
              policy={editingPolicy}
              providers={providers}
              models={models}
              onSubmit={handleUpdate}
              onCancel={() => {
                setIsEditOpen(false);
                setEditingPolicy(null);
              }}
              isSubmitting={updatePolicy.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!disablingPolicy}
        onOpenChange={() => setDisablingPolicy(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Policy?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the budget policy "{disablingPolicy?.name}".
              The policy can be re-enabled by editing it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDisablingPolicy(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisable}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
