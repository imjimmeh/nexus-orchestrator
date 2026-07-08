import type { SkillScope } from '../../../../ai-config/services/agent-skill-library.service.types';

export interface UpdateSkillResult {
  name: string;
  scope: SkillScope | null;
  validated: boolean;
  validation_errors?: string[];
}
