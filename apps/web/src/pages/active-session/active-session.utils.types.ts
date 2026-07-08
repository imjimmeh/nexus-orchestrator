import { UserQuestion } from "@/lib/api/settings.types";
import { SteeringPlan } from "@/lib/api/steering.types";
import type { StepCommandModel } from "./step-command-model.types";

export type ToolCallMetadata = {
  type: "tool_call";
  toolName: string;
  rawToolName?: string;
  callId: string;
  status: "started" | "updated" | "finished";
  summary: string;
  argsObj?: unknown;
  partialResults: unknown[];
  resultObj?: unknown;
  isError: boolean;
  errorText?: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
};

export type CognitiveBlockType =
  | "thought"
  | "tool"
  | "agent"
  | "user"
  | "system"
  | "subagent";

export interface CognitiveBlock {
  id: string;
  type: CognitiveBlockType;
  title: string;
  body: string;
  timestamp: string;
}

export type SessionChatRole = "user" | "agent" | "event";

export interface SessionChatMessage {
  id: string;
  role: SessionChatRole;
  content: string;
  timestamp?: string;
  label?: string;
  category?:
    | "tool"
    | "thought"
    | "system"
    | "question"
    | "container"
    | "agent"
    | "user"
    | "subagent"
    | "command";
  collapsedByDefault?: boolean;
  detailsTitle?: string;
  detailsContent?: string;
  questions?: UserQuestion[];
  metadata?:
    | {
        type: "steering_plan";
        plan: SteeringPlan;
        planId: string;
      }
    | {
        type: "subagent_spawn";
        subagentExecutionId: string;
        chatSessionId?: string | null;
        taskPrompt: string;
        agentProfile: string;
        status: string;
      }
    | {
        type: "command_card";
        model: StepCommandModel;
      }
    | ToolCallMetadata;
}
