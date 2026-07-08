export interface SkillMetadataContract {
  version: string;
  prerequisites: string[];
  tier: 'light' | 'heavy';
  estimated_duration: string;
  category: string;
  tags: string[];
}

export interface SkillValidationResult {
  skillName: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata: SkillMetadataContract | null;
}
