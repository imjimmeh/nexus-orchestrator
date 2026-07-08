export type InvocationInputs = {
  agentProfile: string | null;
  explicitTriggerData: Record<string, unknown>;
  message: string | null;
  objective: string | null;
  reason: string | null;
  reasoning: string | null;
  taskPrompt: string | null;
  workflowId: string;
};

export type ParentContext = {
  basePath: string | null;
  repositoryUrl: string | null;
};
