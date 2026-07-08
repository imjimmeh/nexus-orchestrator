import type { ToolPolicyDocument } from '@nexus/core';

export interface SeedValidationIssue {
  code: string;
  message: string;
  filePath?: string;
  workflowId?: string;
  agentName?: string;
}

export interface SeedValidationSummary {
  workflowCount: number;
  agentCount: number;
  skillCount: number;
  errorCount: number;
  warningCount: number;
}

export interface SeedValidationReport {
  summary: SeedValidationSummary;
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}

export interface SeedValidationParams {
  capabilityNames: string[];
  bridgeActions: string[];
  modelNames: string[];
  providerNames: string[];
}

/**
 * Agent tool allowlist/denylist configuration from seed data.
 */
export interface AgentToolPolicy {
  tool_policy?: ToolPolicyDocument;
}

export interface ParsedAgentSeed {
  name: string;
  tools: string[];
  assignedSkills: string[];
  toolPolicy?: AgentToolPolicy;
}

export interface ParsedWorkflowSeed {
  workflowId: string;
  filePath: string;
  parsed: ReturnType<
    import('../../workflow/workflow-parser.service').WorkflowParserService['parseWorkflow']
  >;
}

export interface SeedRoots {
  workflowsRoot: string;
  agentsRoot: string;
  skillsRoot: string;
}

export interface ValidationCollector {
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}
