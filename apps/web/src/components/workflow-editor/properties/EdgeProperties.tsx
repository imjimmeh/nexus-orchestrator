import type { Edge as XYFlowEdge } from "@xyflow/react";
import { useWorkflowEditorStore } from "../hooks/useWorkflowEditorStore";
import type { EditorAction } from "../hooks/useWorkflowEditorStore.types";
import type {
  WorkflowEdge,
  DependencyEdgeData,
  TransitionEdgeData,
  SwitchEdgeData,
  WorkflowEdgeData,
} from "../serialization/types";
import { SelectField } from "./fields/SelectField";
import { HandlebarsField } from "./fields/HandlebarsField";
import { SwitchField } from "./fields/SwitchField";

const RESULT_POLICY_OPTIONS = [
  { value: "success", label: "Success" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "success_or_skipped", label: "Success or Skipped" },
  { value: "any", label: "Any" },
];

function makeEdgeUpdateAction(
  edgeId: string,
  previousData: Record<string, unknown>,
  newData: Record<string, unknown>,
): EditorAction {
  return {
    type: "update_edge_data",
    payload: { edgeId },
    inverse: () => {
      const currentEdges = useWorkflowEditorStore.getState().edges;
      useWorkflowEditorStore
        .getState()
        .setEdges(
          currentEdges.map((e) =>
            e.id !== edgeId ? e : { ...e, data: previousData },
          ),
        );
      return makeEdgeUpdateAction(edgeId, newData, previousData);
    },
  };
}

function updateEdgeData(
  edgeId: string,
  partial: Record<string, unknown>,
  edges: XYFlowEdge[],
  setEdges: (edges: XYFlowEdge[]) => void,
  pushAction: (action: EditorAction) => void,
) {
  const previousEdge = edges.find((e) => e.id === edgeId);
  if (!previousEdge) return;
  const previousData = { ...previousEdge.data };
  const newData = { ...previousEdge.data, ...partial };

  setEdges(edges.map((e) => (e.id !== edgeId ? e : { ...e, data: newData })));

  pushAction(makeEdgeUpdateAction(edgeId, previousData, newData));
}

function EdgeProperties() {
  const selectedElementId = useWorkflowEditorStore((s) => s.selectedElementId);
  const edges = useWorkflowEditorStore((s) => s.edges);
  const setEdges = useWorkflowEditorStore((s) => s.setEdges);
  const pushAction = useWorkflowEditorStore((s) => s.pushAction);

  const selectedEdge = edges.find((e) => e.id === selectedElementId) as
    | WorkflowEdge
    | undefined;
  if (!selectedEdge) {
    return null;
  }

  const selectedEdgeId = selectedEdge.id;
  const data = selectedEdge.data as WorkflowEdgeData;

  function handleUpdate(partial: Partial<WorkflowEdgeData>) {
    updateEdgeData(
      selectedEdgeId,
      partial as Record<string, unknown>,
      edges,
      setEdges,
      pushAction,
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="border rounded-lg p-3 space-y-3">
        <h3 className="font-medium text-sm">Edge Properties</h3>

        <div className="space-y-1.5">
          <span className="text-sm font-medium leading-none">Kind</span>
          <p className="text-sm text-muted-foreground">{data.kind}</p>
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium leading-none">Source</span>
          <p className="text-sm text-muted-foreground">{selectedEdge.source}</p>
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium leading-none">Target</span>
          <p className="text-sm text-muted-foreground">{selectedEdge.target}</p>
        </div>

        <div className="border-t pt-3 mt-2">
          <h4 className="text-xs font-medium text-muted-foreground mb-2">
            Type-Specific
          </h4>

          {data.kind === "dependency" && (
            <>
              <SelectField
                label="Result Policy"
                value={(data as DependencyEdgeData).resultPolicy ?? "success"}
                onChange={(resultPolicy) =>
                  handleUpdate({
                    resultPolicy:
                      resultPolicy as DependencyEdgeData["resultPolicy"],
                  } as Partial<DependencyEdgeData>)
                }
                options={RESULT_POLICY_OPTIONS}
              />
              <SwitchField
                label="Optional"
                checked={(data as DependencyEdgeData).optional ?? false}
                onChange={(optional) =>
                  handleUpdate({ optional } as Partial<DependencyEdgeData>)
                }
              />
            </>
          )}

          {data.kind === "transition" && (
            <>
              <HandlebarsField
                label="Condition"
                value={(data as TransitionEdgeData).condition}
                onChange={(condition) =>
                  handleUpdate({
                    condition,
                  } as Partial<TransitionEdgeData>)
                }
                placeholder="{{eq step.status 'done'}}"
              />
              <div className="space-y-1.5">
                <span className="text-sm font-medium leading-none">Target</span>
                <p className="text-sm text-muted-foreground">
                  {(data as TransitionEdgeData).target}
                </p>
              </div>
            </>
          )}

          {data.kind === "switch" && (
            <>
              <HandlebarsField
                label="Case Condition"
                value={(data as SwitchEdgeData).caseCondition}
                onChange={(caseCondition) =>
                  handleUpdate({
                    caseCondition,
                  } as Partial<SwitchEdgeData>)
                }
                placeholder="{{eq value 'a'}}"
              />
              <SwitchField
                label="Default"
                checked={(data as SwitchEdgeData).isDefault ?? false}
                onChange={(isDefault) =>
                  handleUpdate({ isDefault } as Partial<SwitchEdgeData>)
                }
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export { EdgeProperties };
