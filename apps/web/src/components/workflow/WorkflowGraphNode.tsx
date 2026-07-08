import { type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Bot,
  GitBranch,
  Globe,
  Link,
  Monitor,
  Package,
  Plug,
  Radio,
  Terminal,
  Wrench,
} from "lucide-react";
import { type Node, type NodeProps } from "@xyflow/react";
import type { WorkflowGraphNode as WorkflowGraphNodeData } from "@/lib/api/workflows.types";
import { GraphNodeCard } from "@/components/workflow/GraphNodeCard";
import { WorkflowNodeStatusBadge } from "@/components/workflow/WorkflowNodeStatusBadge";

export type WorkflowGraphNodePayload = Pick<
  WorkflowGraphNodeData,
  "label" | "kind" | "status" | "metadata" | "jobId" | "stepId" | "parentJobId"
> & {
  hasSteps?: boolean;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
};

interface NodePresentation {
  accentColor: string;
  icon: ReactNode;
  typeLabel: string;
}

const JOB_TYPE_PRESENTATIONS = {
  execution: { icon: Bot, accentColor: "bg-info", typeLabel: "Execution" },
  invoke_workflow: {
    icon: Link,
    accentColor: "bg-accent-purple",
    typeLabel: "Invoke Workflow",
  },
  run_command: {
    icon: Terminal,
    accentColor: "bg-success",
    typeLabel: "Run Command",
  },
  emit_event: {
    icon: Radio,
    accentColor: "bg-accent-orange",
    typeLabel: "Emit Event",
  },
  /* categorical accents — no semantic token equivalent; update these to retheme node type chips */
  http_webhook: {
    icon: Globe,
    accentColor: "bg-cyan-500",
    typeLabel: "HTTP Webhook",
  },
  web_automation: {
    icon: Monitor,
    accentColor: "bg-pink-500",
    typeLabel: "Web Automation",
  },
  mcp_tool_call: {
    icon: Plug,
    accentColor: "bg-teal-500",
    typeLabel: "MCP Tool Call",
  },
  git_operation: {
    icon: GitBranch,
    accentColor: "bg-gray-500",
    typeLabel: "Git Operation",
  },
  register_tool: {
    icon: Wrench,
    accentColor: "bg-warning",
    typeLabel: "Register Tool",
  },
  manage_tool_candidate: {
    icon: Package,
    accentColor: "bg-accent-purple",
    typeLabel: "Manage Tool Candidate",
  },
} as const;

const STEP_TYPE_PRESENTATIONS = {
  agent: { icon: Bot, accentColor: "bg-info", typeLabel: "Agent" },
  run_command: {
    icon: Terminal,
    accentColor: "bg-success",
    typeLabel: "Command",
  },
  set_variable: {
    icon: Wrench,
    accentColor: "bg-warning",
    typeLabel: "Set Variable",
  },
  /* categorical accent — no semantic token equivalent */
  wait: { icon: Radio, accentColor: "bg-slate-400", typeLabel: "Wait" },
} as const;

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: "tier" | "type" | "jobType" | "stepType",
): string | undefined {
  const value = metadata?.[key];
  return isString(value) ? value.trim() : undefined;
}

function resolvePresentation(
  kind: WorkflowGraphNodeData["kind"],
  metadata: Record<string, unknown> | undefined,
): NodePresentation {
  if (kind === "job") {
    const jobType =
      readMetadataString(metadata, "type") ??
      readMetadataString(metadata, "jobType");
    if (jobType && jobType in JOB_TYPE_PRESENTATIONS) {
      const presentation =
        JOB_TYPE_PRESENTATIONS[jobType as keyof typeof JOB_TYPE_PRESENTATIONS];
      return {
        accentColor: presentation.accentColor,
        icon: <presentation.icon className="h-4 w-4" />,
        typeLabel: presentation.typeLabel,
      };
    }

    return {
      accentColor: "bg-info",
      icon: <Bot className="h-4 w-4" />,
      typeLabel: "Job",
    };
  }

  const stepType =
    readMetadataString(metadata, "type") ??
    readMetadataString(metadata, "stepType");
  if (stepType && stepType in STEP_TYPE_PRESENTATIONS) {
    const presentation =
      STEP_TYPE_PRESENTATIONS[stepType as keyof typeof STEP_TYPE_PRESENTATIONS];
    return {
      accentColor: presentation.accentColor,
      icon: <presentation.icon className="h-3 w-3 text-muted-foreground" />,
      typeLabel: presentation.typeLabel,
    };
  }

  return {
    accentColor: "bg-slate-400", // categorical — no semantic token
    icon: <Bot className="h-3 w-3 text-muted-foreground" />,
    typeLabel: "Step",
  };
}

function readTier(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  return readMetadataString(metadata, "tier");
}

function getSecondaryText(data: WorkflowGraphNodePayload): string | undefined {
  if (data.kind === "job") {
    return data.jobId;
  }

  return data.stepId;
}

function getExpandButtonLabel(isExpanded: boolean | undefined): string {
  return isExpanded ? "Collapse steps" : "Expand steps";
}

export type WorkflowGraphNodeType = Node<
  WorkflowGraphNodePayload,
  "workflowNode"
>;

export function WorkflowGraphNode({ data }: NodeProps<WorkflowGraphNodeType>) {
  const presentation = resolvePresentation(data.kind, data.metadata);
  const secondaryText = getSecondaryText(data);
  const tier = readTier(data.metadata);
  const showExpandButton =
    data.kind === "job" &&
    data.hasSteps &&
    typeof data.onToggleExpanded === "function";

  return (
    <GraphNodeCard
      icon={presentation.icon}
      typeLabel={presentation.typeLabel}
      title={data.label}
      accentColor={presentation.accentColor}
      secondaryText={secondaryText}
      tier={tier}
      statusSlot={
        <WorkflowNodeStatusBadge status={data.status} className="mt-1" />
      }
      actionSlot={
        showExpandButton ? (
          <button
            type="button"
            className="nodrag nopan inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label={getExpandButtonLabel(data.isExpanded)}
            title={getExpandButtonLabel(data.isExpanded)}
            onClick={() => data.onToggleExpanded?.()}
          >
            {data.isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : undefined
      }
      compact={data.kind === "step"}
    />
  );
}
