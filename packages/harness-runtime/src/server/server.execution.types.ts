import type { HarnessRuntimeConfig } from "@nexus/core";

export interface ExecuteAgentRequest {
  provider: string;
  model: string;
  auth?: HarnessRuntimeConfig["model"]["auth"];
  apiKey?: string;
  baseUrl?: string;
  providerConfig?: HarnessRuntimeConfig["model"]["providerConfig"];
  systemPrompt: string;
  initialPrompt?: string;
  temperature?: number;
  thinkingLevel?: HarnessRuntimeConfig["model"]["thinkingLevel"];
  stepId: string;
  background?: boolean;
  mode?: "async" | "sync";
}

export interface AgentStepResult {
  ok: boolean;
  response: string;
  error?: string;
  usage?: unknown;
  producedSessionId?: string;
  suspended?: boolean;
}
