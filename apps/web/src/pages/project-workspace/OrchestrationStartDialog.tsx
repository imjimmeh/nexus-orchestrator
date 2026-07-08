import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectOrchestrationMode, ProjectOrchestrationStatus } from "@/lib/api/projects.types";

interface OrchestrationStartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orchestrationStatus: ProjectOrchestrationStatus | null;
  mode: ProjectOrchestrationMode;
  onModeChange: (mode: ProjectOrchestrationMode) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  canSubmit: boolean;
}

export function OrchestrationStartDialog({
  open,
  onOpenChange,
  orchestrationStatus,
  mode,
  onModeChange,
  onSubmit,
  isSubmitting,
  canSubmit,
}: Readonly<OrchestrationStartDialogProps>) {
  const isRestart =
    orchestrationStatus === "failed" || orchestrationStatus === "completed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isRestart
              ? "Restart Project Orchestration"
              : "Start Project Orchestration"}
          </DialogTitle>
          <DialogDescription>
            {orchestrationStatus === "failed"
              ? "The previous orchestration failed. Goals are maintained in the Goals tab."
              : isRestart
                ? "The previous cycle has completed. Goals are maintained in the Goals tab."
                : "Goals are maintained in the Goals tab. Select orchestration mode to start."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="orchestration-mode">Mode</Label>
            <Select
              value={mode}
              onValueChange={(value) =>
                onModeChange(value as ProjectOrchestrationMode)
              }
            >
              <SelectTrigger id="orchestration-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="supervised">supervised</SelectItem>
                <SelectItem value="autonomous">autonomous</SelectItem>
                <SelectItem value="notifications_only">
                  notifications_only
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isSubmitting || !canSubmit}>
            {isRestart ? "Restart Orchestration" : "Start Orchestration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
