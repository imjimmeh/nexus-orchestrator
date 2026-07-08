export interface SkillScope {
  projects: string[];
  agents: string[];
  workflows: string[];
}

export interface SkillScopeContext {
  scopeId?: string;
  agentProfile?: string;
  workflowId?: string;
}

export interface SkillLibraryRecord {
  id: string;
  name: string;
  description: string;
  skillMarkdown: string;
  compatibility: string | null;
  category: string | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  scope: SkillScope | null;
  isActive: boolean;
  version: number;
  source: 'admin' | 'agent_factory' | 'imported';
  createdAt: Date;
  updatedAt: Date;
  rootPath: string;
}
