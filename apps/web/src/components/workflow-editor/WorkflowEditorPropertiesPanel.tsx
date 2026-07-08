import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";
import { ValidationErrorDisplay } from "./ValidationErrorDisplay";
import { WorkflowProperties } from "./properties/WorkflowProperties";
import { JobProperties } from "./properties/JobProperties";
import { StepProperties } from "./properties/StepProperties";
import { EdgeProperties } from "./properties/EdgeProperties";

const PANEL_STYLES = "min-w-[280px] w-full";

interface WorkflowEditorPropertiesPanelProps {
  supportsLifecycleTriggers?: boolean;
}

function WorkflowEditorPropertiesPanel({
  supportsLifecycleTriggers = false,
}: WorkflowEditorPropertiesPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const selectedElementId = useWorkflowEditorStore((s) => s.selectedElementId);
  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const edges = useWorkflowEditorStore((s) => s.edges);

  function resolveContent() {
    if (selectedElementId === null) {
      return (
        <WorkflowProperties
          supportsLifecycleTriggers={supportsLifecycleTriggers}
        />
      );
    }

    const selectedNode = nodes.find((n) => n.id === selectedElementId);
    if (selectedNode) {
      if (selectedNode.type === "job") return <JobProperties />;
      if (selectedNode.type === "step") return <StepProperties />;
    }

    const selectedEdge = edges.find((e) => e.id === selectedElementId);
    if (selectedEdge) return <EdgeProperties />;

    return (
      <WorkflowProperties
        supportsLifecycleTriggers={supportsLifecycleTriggers}
      />
    );
  }

  if (collapsed) {
    return (
      <div className="border-l bg-card flex flex-col items-center pt-3 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Toggle Properties Panel"
          onClick={() => setCollapsed(false)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span
          className="text-xs text-muted-foreground mt-2"
          style={{ writingMode: "vertical-rl" }}
        >
          Properties
        </span>
      </div>
    );
  }

  return (
    <div className={`${PANEL_STYLES} border-l bg-card flex flex-col shrink-0`}>
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium">Properties</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Toggle Properties Panel"
          onClick={() => setCollapsed(true)}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </div>
      <ValidationErrorDisplay />
      <div className="flex-1 overflow-y-auto">{resolveContent()}</div>
    </div>
  );
}

export { WorkflowEditorPropertiesPanel };
