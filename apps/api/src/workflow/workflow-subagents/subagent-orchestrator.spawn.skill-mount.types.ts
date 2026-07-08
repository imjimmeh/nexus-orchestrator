/**
 * Resolved skill-mount inputs for a spawning subagent's container. Split out
 * of `subagent-orchestrator.spawn.operations.ts` (Task 4) to keep that file
 * under the project's `max-lines` lint cap.
 */
export interface SkillMountContext {
  assignedSkills: Array<{
    name: string;
    description: string;
    skillMarkdown: string;
  }>;
  skillMountKey: string;
  skillMountPath: string | null;
}
