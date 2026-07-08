import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";

interface WorkflowEditorHeaderProps {
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  isEditMode: boolean;
}

function WorkflowEditorHeader({
  onSave,
  onCancel,
  isSaving,
  isEditMode,
}: WorkflowEditorHeaderProps) {
  const name = useWorkflowEditorStore((s) => s.name);
  const active = useWorkflowEditorStore((s) => s.active);
  const isDirty = useWorkflowEditorStore((s) => s.isDirty);
  const setMetadata = useWorkflowEditorStore((s) => s.setMetadata);

  return (
    <div className="flex items-center gap-3 border-b px-4 py-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={onCancel}
        aria-label={isEditMode ? "Back to editor" : "Back"}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      <div className="flex items-center gap-2">
        <Label htmlFor="workflow-name" className="sr-only">
          Name
        </Label>
        <Input
          id="workflow-name"
          value={name}
          onChange={(e) => setMetadata({ name: e.target.value })}
          className="h-8 w-48"
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="workflow-active"
          checked={active}
          onCheckedChange={(checked) =>
            setMetadata({ active: checked === true })
          }
          aria-label="Active"
        />
        <Label htmlFor="workflow-active" className="cursor-pointer text-sm">
          Active
        </Label>
      </div>

      {isDirty && (
        <span
          className="text-muted-foreground text-sm"
          aria-label="Unsaved changes"
        >
          *
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>

        <Button size="sm" onClick={onSave} disabled={!isDirty || isSaving}>
          <Save className="mr-1 h-4 w-4" />
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

export { WorkflowEditorHeader };
export type { WorkflowEditorHeaderProps };
