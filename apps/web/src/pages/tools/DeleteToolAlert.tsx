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
import { Tool } from "@/lib/api/tools.types";

interface DeleteToolAlertProps {
  deletingTool: Tool | null;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirmDelete: () => Promise<void>;
}

export function DeleteToolAlert(props: Readonly<DeleteToolAlertProps>) {
  const { deletingTool, onOpenChange, onCancel, onConfirmDelete } = props;
  return (
    <AlertDialog open={!!deletingTool} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete tool &quot;{deletingTool?.name}&quot;.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void onConfirmDelete();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
