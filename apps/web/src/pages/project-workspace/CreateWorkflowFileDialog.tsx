import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMPTY_WORKFLOW_TEMPLATE = `workflow_id: ""
name: ""
description: ""
trigger:
  type: lifecycle
  phase: ready-to-merge
  hook: before
  blocking: true
global_env: {}
jobs: []
`;

interface CreateWorkflowFileDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly projectId: string;
  readonly onCreated?: () => void;
}

export function CreateWorkflowFileDialog({
  open,
  onClose,
  projectId,
  onCreated,
}: CreateWorkflowFileDialogProps) {
  const [filename, setFilename] = useState("");
  const navigate = useNavigate();

  const handleCreate = () => {
    const name = filename.endsWith(".workflow.yaml")
      ? filename
      : `${filename}.workflow.yaml`;
    navigate(
      `/projects/${projectId}/workflow-files/${encodeURIComponent(name)}/edit`,
      {
        state: { template: EMPTY_WORKFLOW_TEMPLATE },
      },
    );
    onCreated?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Workflow File</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="filename">Filename</Label>
            <Input
              id="filename"
              placeholder="my-workflow.workflow.yaml"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && filename && handleCreate()}
            />
            <p className="text-xs text-muted-foreground">
              Stored in .nexus/workflows/ directory
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!filename.trim()}>
            Create &amp; Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
