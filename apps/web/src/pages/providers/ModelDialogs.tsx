import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ModelForm } from "../models/ModelForm";
import { LLMModel } from "@/lib/api/models.types";
import { LLMProvider } from "@/lib/api/providers.types";

interface ModelDialogsProps {
  creatingModelForProvider: LLMProvider | null;
  onCloseCreate: () => void;
  onCreateSubmit: (data: {
    name: string;
    token_limit: number;
    input_token_cents_per_million?: number | null;
    output_token_cents_per_million?: number | null;
    default_for_execution: boolean;
    default_for_distillation: boolean;
    default_for_summarization: boolean;
    default_for_session: boolean;
    supports_embedding: boolean;
    embedding_dimension?: number | null;
    default_for_embedding: boolean;
  }) => void;
  isCreateSubmitting: boolean;

  editingModel: LLMModel | null;
  editingModelProvider: LLMProvider | null;
  onCloseEdit: () => void;
  onEditSubmit: (data: {
    name: string;
    token_limit: number;
    input_token_cents_per_million?: number | null;
    output_token_cents_per_million?: number | null;
    default_for_execution: boolean;
    default_for_distillation: boolean;
    default_for_summarization: boolean;
    default_for_session: boolean;
    supports_embedding: boolean;
    embedding_dimension?: number | null;
    default_for_embedding: boolean;
  }) => void;
  isEditSubmitting: boolean;

  deletingModel: LLMModel | null;
  onCloseDelete: () => void;
  onDeleteConfirm: () => void;
  isDeleteSubmitting: boolean;
}

export function ModelDialogs({
  creatingModelForProvider,
  onCloseCreate,
  onCreateSubmit,
  isCreateSubmitting,
  editingModel,
  editingModelProvider,
  onCloseEdit,
  onEditSubmit,
  isEditSubmitting,
  deletingModel,
  onCloseDelete,
  onDeleteConfirm,
  isDeleteSubmitting,
}: Readonly<ModelDialogsProps>) {
  return (
    <>
      <Dialog
        open={!!creatingModelForProvider}
        onOpenChange={(open) => {
          if (!open) onCloseCreate();
        }}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              Add Model to {creatingModelForProvider?.name}
            </DialogTitle>
          </DialogHeader>
          {creatingModelForProvider && (
            <ModelForm
              provider={creatingModelForProvider}
              onSubmit={onCreateSubmit}
              onCancel={onCloseCreate}
              isSubmitting={isCreateSubmitting}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingModel}
        onOpenChange={(open) => {
          if (!open) onCloseEdit();
        }}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Model</DialogTitle>
          </DialogHeader>
          {editingModel && editingModelProvider && (
            <ModelForm
              model={editingModel}
              provider={editingModelProvider}
              onSubmit={onEditSubmit}
              onCancel={onCloseEdit}
              isSubmitting={isEditSubmitting}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deletingModel}
        onOpenChange={(open) => {
          if (!open) onCloseDelete();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the model "{deletingModel?.name}".
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCloseDelete}>
              Cancel
            </AlertDialogCancel>
            <Button
              onClick={onDeleteConfirm}
              disabled={isDeleteSubmitting}
              variant="destructive"
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
