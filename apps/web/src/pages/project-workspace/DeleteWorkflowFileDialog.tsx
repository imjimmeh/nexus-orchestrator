import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeleteWorkflowFileDialogProps {
  readonly open: boolean;
  readonly filename: string;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function DeleteWorkflowFileDialog({
  open,
  filename,
  onClose,
  onConfirm,
}: DeleteWorkflowFileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Workflow File</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete{" "}
            <code className="bg-muted px-1 rounded">{filename}</code>? This will
            remove it from .nexus/workflows/ and commit the deletion.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
