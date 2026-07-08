import { useState } from "react";
import {
  useSecrets,
  useCreateSecret,
  useUpdateSecret,
  useDeleteSecret,
} from "@/hooks/useSecrets";
import { Secret } from "@/lib/api/secrets.types";
import { useScopeContext } from "@/context/ScopeContext";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { SecretForm } from "./SecretForm";
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
import { formatDateTimeSafe } from "@/lib/utils";

export function Secrets() {
  const { activeScopeNodeId } = useScopeContext();
  const { data: secrets = [], isLoading } = useSecrets({
    scopeNodeId: activeScopeNodeId,
  });
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();
  const deleteSecret = useDeleteSecret();

  const [editingSecret, setEditingSecret] = useState<Secret | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deletingSecret, setDeletingSecret] = useState<Secret | null>(null);

  const handleCreate = async (data: { name: string; value: string }) => {
    const parsedValue = JSON.parse(data.value);

    await createSecret.mutateAsync({
      name: data.name,
      value: parsedValue,
    });

    setIsCreateOpen(false);
  };

  const handleUpdate = async (data: { name: string; value: string }) => {
    if (!editingSecret) return;

    const parsedValue = JSON.parse(data.value);

    await updateSecret.mutateAsync({
      id: editingSecret.id,
      data: {
        name: data.name,
        value: parsedValue,
      },
    });

    setIsEditOpen(false);
    setEditingSecret(null);
  };

  const handleDelete = async () => {
    if (!deletingSecret) return;

    await deleteSecret.mutateAsync(deletingSecret.id);
    setDeletingSecret(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Secrets</h2>
          <p className="text-muted-foreground">
            Manage API keys and credentials
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Secret
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create Secret</DialogTitle>
            </DialogHeader>
            <SecretForm
              onSubmit={handleCreate}
              onCancel={() => setIsCreateOpen(false)}
              isSubmitting={createSecret.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : secrets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center">
                  No secrets found
                </TableCell>
              </TableRow>
            ) : (
              secrets.map((secret) => (
                <TableRow key={secret.id}>
                  <TableCell className="font-medium">{secret.name}</TableCell>
                  <TableCell>
                    {formatDateTimeSafe(secret.created_at, "Unknown time")}
                  </TableCell>
                  <TableCell>
                    {formatDateTimeSafe(secret.updated_at, "Unknown time")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingSecret(secret);
                          setIsEditOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingSecret(secret)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Secret</DialogTitle>
          </DialogHeader>
          {editingSecret && (
            <SecretForm
              secret={editingSecret}
              onSubmit={handleUpdate}
              onCancel={() => {
                setIsEditOpen(false);
                setEditingSecret(null);
              }}
              isSubmitting={updateSecret.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingSecret}
        onOpenChange={() => setDeletingSecret(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the secret "{deletingSecret?.name}".
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingSecret(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
