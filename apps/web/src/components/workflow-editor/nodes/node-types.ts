import {
  Bot,
  Link,
  Terminal,
  Radio,
  Globe,
  Monitor,
  Plug,
  GitBranch,
  Wrench,
  Package,
  type LucideIcon,
} from "lucide-react";
import type { JobType, StepType } from "../serialization/types";

export const JOB_TYPE_CONFIG: Record<
  JobType,
  { icon: LucideIcon; color: string; label: string }
> = {
  execution: { icon: Bot, color: "bg-blue-500", label: "Execution" },
  invoke_workflow: {
    icon: Link,
    color: "bg-purple-500",
    label: "Invoke Workflow",
  },
  run_command: {
    icon: Terminal,
    color: "bg-green-500",
    label: "Run Command",
  },
  emit_event: { icon: Radio, color: "bg-orange-500", label: "Emit Event" },
  http_webhook: { icon: Globe, color: "bg-cyan-500", label: "HTTP Webhook" },
  web_automation: {
    icon: Monitor,
    color: "bg-pink-500",
    label: "Web Automation",
  },
  mcp_tool_call: {
    icon: Plug,
    color: "bg-teal-500",
    label: "MCP Tool Call",
  },
  git_operation: {
    icon: GitBranch,
    color: "bg-gray-500",
    label: "Git Operation",
  },
  register_tool: {
    icon: Wrench,
    color: "bg-yellow-500",
    label: "Register Tool",
  },
  manage_tool_candidate: {
    icon: Package,
    color: "bg-violet-500",
    label: "Manage Tool Candidate",
  },
};

export const STEP_TYPE_CONFIG: Record<
  StepType,
  { icon: LucideIcon; color: string; label: string }
> = {
  agent: { icon: Bot, color: "bg-blue-400", label: "Agent" },
  run_command: { icon: Terminal, color: "bg-green-400", label: "Command" },
  set_variable: { icon: Wrench, color: "bg-amber-400", label: "Set Variable" },
  wait: { icon: Radio, color: "bg-slate-400", label: "Wait" },
};
