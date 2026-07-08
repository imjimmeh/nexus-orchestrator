import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { JOB_TYPE_CONFIG } from "./nodes/node-types";
import type { JobType } from "./serialization/types";

const GROUP_DEFINITIONS: { label: string; jobTypes: JobType[] }[] = [
  { label: "Execution", jobTypes: ["execution"] },
  {
    label: "Integration",
    jobTypes: [
      "invoke_workflow",
      "http_webhook",
      "mcp_tool_call",
      "web_automation",
    ],
  },
  {
    label: "Utility",
    jobTypes: [
      "run_command",
      "emit_event",
      "git_operation",
      "register_tool",
      "manage_tool_candidate",
    ],
  },
];

function handleDragStart(
  event: React.DragEvent<HTMLDivElement>,
  jobType: JobType,
) {
  event.dataTransfer.setData("application/reactflow", jobType);
  event.dataTransfer.effectAllowed = "move";
}

function WorkflowEditorNodePalette() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex flex-col border-r bg-background h-full min-w-[220px]">
      <div className="flex items-center justify-between border-b px-2 py-1">
        {!collapsed && (
          <span className="text-sm font-medium truncate">Node Palette</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? "Expand palette" : "Collapse palette"}
          className={collapsed ? "mx-auto" : "ml-auto"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {GROUP_DEFINITIONS.map((group) => (
          <section key={group.label}>
            {!collapsed && (
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
                {group.label}
              </h3>
            )}
            <div className="space-y-1">
              {group.jobTypes.map((jobType) => {
                const config = JOB_TYPE_CONFIG[jobType];
                const Icon = config.icon;

                return (
                  <div
                    key={jobType}
                    draggable
                    onDragStart={(event) => handleDragStart(event, jobType)}
                    className="flex items-center gap-2 rounded-md border px-2 py-1.5 cursor-grab active:cursor-grabbing hover:bg-accent transition-colors"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!collapsed && (
                      <span className="text-sm truncate">{config.label}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export { WorkflowEditorNodePalette };
