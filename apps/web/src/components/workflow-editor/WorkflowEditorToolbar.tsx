import {
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  GitGraph,
  FileCode2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";

interface WorkflowEditorToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onAutoLayout: () => void;
  onToggleYamlPreview: () => void;
}

function WorkflowEditorToolbar({
  onZoomIn,
  onZoomOut,
  onFitView,
  onAutoLayout,
  onToggleYamlPreview,
}: WorkflowEditorToolbarProps) {
  const undoStack = useWorkflowEditorStore((s) => s.undoStack);
  const redoStack = useWorkflowEditorStore((s) => s.redoStack);
  const selectedElementId = useWorkflowEditorStore((s) => s.selectedElementId);
  const undo = useWorkflowEditorStore((s) => s.undo);
  const redo = useWorkflowEditorStore((s) => s.redo);
  const deleteSelectedElement = useWorkflowEditorStore(
    (s) => s.deleteSelectedElement,
  );

  return (
    <div className="flex items-center gap-1 border-t px-3 py-1.5">
      <Button
        variant="ghost"
        size="icon"
        onClick={undo}
        disabled={undoStack.length === 0}
        aria-label="Undo"
      >
        <Undo2 className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={redo}
        disabled={redoStack.length === 0}
        aria-label="Redo"
      >
        <Redo2 className="h-4 w-4" />
      </Button>

      <div className="w-px h-5 bg-border mx-1" />

      <Button
        variant="ghost"
        size="icon"
        onClick={deleteSelectedElement}
        disabled={selectedElementId === null}
        aria-label="Delete selected"
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <div className="w-px h-5 bg-border mx-1" />

      <Button
        variant="ghost"
        size="icon"
        onClick={onZoomIn}
        aria-label="Zoom In"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={onZoomOut}
        aria-label="Zoom Out"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={onFitView}
        aria-label="Fit View"
      >
        <Maximize2 className="h-4 w-4" />
      </Button>

      <div className="w-px h-5 bg-border mx-1" />

      <Button
        variant="ghost"
        size="sm"
        onClick={onAutoLayout}
        aria-label="Auto Layout"
      >
        <GitGraph className="mr-1 h-4 w-4" />
        Auto Layout
      </Button>

      <div className="flex-1" />

      <Button
        variant="outline"
        size="sm"
        onClick={onToggleYamlPreview}
        aria-label="YAML Preview"
      >
        <FileCode2 className="mr-1 h-4 w-4" />
        YAML
      </Button>
    </div>
  );
}

export { WorkflowEditorToolbar };
export type { WorkflowEditorToolbarProps };
