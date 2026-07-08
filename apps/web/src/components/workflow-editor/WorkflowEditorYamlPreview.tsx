import { useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { YamlEditor } from "@/components/workflow/YamlEditor";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";
import { serializeGraphToYaml } from "./serialization/graph-to-yaml";
import { parseYamlToGraph } from "./serialization/yaml-to-graph";
import type { JobNode, StepNode, WorkflowEdge } from "./serialization/types";

interface WorkflowEditorYamlPreviewProps {
  isVisible: boolean;
}

function WorkflowEditorYamlPreview({
  isVisible,
}: WorkflowEditorYamlPreviewProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(true);

  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const edges = useWorkflowEditorStore((s) => s.edges);
  const workflowId = useWorkflowEditorStore((s) => s.workflowId);
  const name = useWorkflowEditorStore((s) => s.name);
  const description = useWorkflowEditorStore((s) => s.description);
  const trigger = useWorkflowEditorStore((s) => s.trigger);
  const concurrency = useWorkflowEditorStore((s) => s.concurrency);
  const permissions = useWorkflowEditorStore((s) => s.permissions);
  const globalEnv = useWorkflowEditorStore((s) => s.globalEnv);
  const strictDependencies = useWorkflowEditorStore(
    (s) => s.strictDependencies,
  );
  const active = useWorkflowEditorStore((s) => s.active);

  if (!isVisible) {
    return null;
  }

  const yaml = serializeGraphToYaml({
    metadata: {
      workflowId,
      name,
      description,
      trigger,
      concurrency,
      permissions,
      globalEnv,
      strictDependencies,
      active,
    },
    nodes: nodes as Array<JobNode | StepNode>,
    edges: edges as WorkflowEdge[],
  });

  function handleYamlChange(value: string | undefined) {
    if (!value) return;
    try {
      const parsed = parseYamlToGraph(value);
      useWorkflowEditorStore.getState().resetState({
        workflowId: parsed.metadata.workflowId ?? workflowId,
        name: parsed.metadata.name,
        description: parsed.metadata.description,
        active: parsed.metadata.active,
        trigger: parsed.metadata.trigger,
        concurrency: parsed.metadata.concurrency,
        permissions: parsed.metadata.permissions,
        globalEnv: parsed.metadata.globalEnv,
        strictDependencies: parsed.metadata.strictDependencies,
        nodes: parsed.nodes,
        edges: parsed.edges,
      });
    } catch {
      // Let user edit freely even if YAML is invalid during typing
    }
  }

  if (collapsed) {
    return (
      <div className="border-t bg-card flex items-center shrink-0 px-3 py-1.5 gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Toggle YAML Preview"
          onClick={() => setCollapsed(false)}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">YAML Preview</span>
      </div>
    );
  }

  return (
    <div className="border-t bg-card flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-1.5 border-b">
        <span className="text-sm font-medium">YAML Preview</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={editing ? "Preview mode" : "Edit YAML"}
            onClick={() => setEditing((prev) => !prev)}
          >
            {editing ? (
              <Eye className="h-4 w-4" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Toggle YAML Preview"
            onClick={() => setCollapsed(true)}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div style={{ height: 240 }}>
        <YamlEditor
          value={yaml}
          onChange={editing ? handleYamlChange : undefined}
          readOnly={!editing}
          height="100%"
        />
      </div>
    </div>
  );
}

export { WorkflowEditorYamlPreview };
export type { WorkflowEditorYamlPreviewProps };
