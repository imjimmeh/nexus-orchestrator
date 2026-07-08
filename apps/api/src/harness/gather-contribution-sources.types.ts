export interface SkillLike {
  metadata?: Record<string, unknown> | null;
}

export interface GatherInput {
  stepInput?: unknown;
  profile?: unknown;
  skills?: SkillLike[];
}
