import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

interface SettingsTabDangerZoneSectionProps {
  isDeleting: boolean;
  deleteDialogOpen: boolean;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
}

export function SettingsTabDangerZoneSection({
  isDeleting,
  deleteDialogOpen,
  onDeleteDialogOpenChange,
  onConfirmDelete,
}: Readonly<SettingsTabDangerZoneSectionProps>) {
  return (
    <>
      <div className="space-y-2 border-t pt-4">
        <Label className="text-destructive">Danger Zone</Label>
        <p className="text-sm text-muted-foreground">
          Delete this project and all associated work items, workflow executions,
          orchestration records, and related telemetry.
        </p>
        <Button
          variant="destructive"
          onClick={() => onDeleteDialogOpenChange(true)}
          disabled={isDeleting}
        >
          {isDeleting ? "Deleting Project..." : "Delete Project"}
        </Button>
      </div>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={onDeleteDialogOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This action permanently deletes the project, work items, workflow
              runs, and related records. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete Project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}