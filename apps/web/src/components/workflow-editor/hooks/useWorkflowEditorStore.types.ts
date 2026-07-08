import type { Edge, Node } from "@xyflow/react";
import type {
  IConcurrencyPolicy,
  IToolPermissionPolicy,
  IWorkflowTrigger,
  IWorkflowLaunchInput,
} from "@nexus/core";

export type ConcurrencyConfig = IConcurrencyPolicy;
export type PermissionsConfig = IToolPermissionPolicy;

/**
 * Editor has richer launch-context choices than the backend YAML/API;
 * serialization maps them to the backend shape later.
 */
export interface TriggerConfig extends Omit<IWorkflowTrigger, "launch"> {
  launch?: {
    context?: "none" | "scope" | "context" | "resource";
    allow_raw_json?: boolean;
    inputs?: IWorkflowLaunchInput[];
  };
}

export interface EditorAction {
  type:
    | "add_node"
    | "remove_node"
    | "update_node_data"
    | "add_edge"
    | "remove_edge"
    | "update_edge_data"
    | "move_node"
    | "update_metadata";
  payload: unknown;
  inverse: () => EditorAction;
}

export interface WorkflowEditorData {
  workflowId: string;
  name: string;
  description: string;
  active: boolean;
  trigger: TriggerConfig | null;
  concurrency: ConcurrencyConfig | null;
  globalEnv: Record<string, string>;
  permissions: PermissionsConfig | null;
  strictDependencies: boolean;
  nodes: Node[];
  edges: Edge[];
  selectedElementId: string | null;
  isDirty: boolean;
  undoStack: EditorAction[];
  redoStack: EditorAction[];
  validationErrors: Record<string, string>;
}

export interface WorkflowEditorActions {
  setMetadata: (
    partial: Partial<
      Pick<
        WorkflowEditorData,
        | "workflowId"
        | "name"
        | "description"
        | "active"
        | "trigger"
        | "concurrency"
        | "globalEnv"
        | "permissions"
        | "strictDependencies"
      >
    >,
  ) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setSelectedElementId: (id: string | null) => void;
  deleteSelectedElement: () => void;
  pushAction: (action: EditorAction) => void;
  undo: () => void;
  redo: () => void;
  markClean: () => void;
  resetState: (state: Partial<WorkflowEditorData>) => void;
  setValidationErrors: (errors: Record<string, string>) => void;
  clearValidationErrors: () => void;
}

export type WorkflowEditorState = WorkflowEditorData & WorkflowEditorActions;
