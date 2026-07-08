export interface ContractDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly location: string;
  readonly filePath?: string;
  readonly workflowId?: string;
}

export interface PromptContractMentions {
  readonly toolNames: string[];
  readonly setJobOutputKeys: string[];
  readonly eventNames: string[];
}

export interface WorkflowContractGraph {
  readonly workflowId: string;
  readonly jobIds: Set<string>;
  readonly declaredOutputKeysByJob: Map<string, Set<string>>;
  readonly requiredOutputKeysByJob: Map<string, Set<string>>;
  readonly downstreamOutputRefs: Map<string, Set<string>>;
  readonly promptMentionsByJob: Map<string, PromptContractMentions>;
  readonly emittedEvents: Set<string>;
  readonly consumedEvents: Set<string>;
  readonly concurrencyScopes: string[];
  readonly mcpToolCallsByJob: Map<string, string>;
}
