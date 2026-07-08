import { extractYamlSkillNames } from '../workflow-yaml-skills.helpers';
import type { SkillExistenceCatalog } from './workflow-validation.skill-rules.types';
import {
  ValidationCollector,
  ValidationContext,
} from './workflow-validation.types';

export type { SkillExistenceCatalog } from './workflow-validation.skill-rules.types';

const UNKNOWN_SKILL_WARNING_CODE = 'unknown_skill_reference';

/**
 * Sentinel job id used to key workflow-level (as opposed to per-job)
 * `skills:` references in the collected map below, so both origins can
 * share the same lookup/reporting pass.
 */
const WORKFLOW_LEVEL_SKILL_ORIGIN = '__workflow__';

/**
 * Validates YAML-declared `skills:` references (workflow-level `skills` and
 * per-job `inputs.skills`, Epic B Task 5) against the skill library. Unknown
 * names are reported as *warnings*, never errors — a workflow may reference
 * a skill that hasn't been authored yet. Structural shape (must be an array
 * of strings) is already enforced at parse time by
 * `WorkflowParserService.validateSkillsShape`.
 *
 * No-ops when `skillCatalog` is absent (constructor-optional on
 * `WorkflowValidationService` so existing manual/test instantiations that
 * don't wire a skill catalog keep behaving exactly as before).
 */
export function validateSkillReferences(
  context: ValidationContext,
  collector: ValidationCollector,
  skillCatalog: SkillExistenceCatalog | undefined,
): void {
  if (!skillCatalog) {
    return;
  }

  const jobIdsBySkillName = collectJobIdsBySkillName(context);
  if (jobIdsBySkillName.size === 0) {
    return;
  }

  const knownSkillNames = new Set(
    skillCatalog
      .listSkills({ includeInactive: true })
      .map((skill) => skill.name),
  );

  for (const [skillName, jobIds] of jobIdsBySkillName) {
    if (knownSkillNames.has(skillName)) {
      continue;
    }

    for (const jobId of jobIds) {
      collector.addWarning(
        jobId === WORKFLOW_LEVEL_SKILL_ORIGIN
          ? `Workflow references unknown skill '${skillName}'`
          : `Job '${jobId}' references unknown skill '${skillName}'`,
        UNKNOWN_SKILL_WARNING_CODE,
      );
    }
  }
}

function collectJobIdsBySkillName(
  context: ValidationContext,
): Map<string, Set<string>> {
  const jobIdsBySkillName = new Map<string, Set<string>>();

  const addReference = (skillName: string, jobId: string): void => {
    const jobIds = jobIdsBySkillName.get(skillName) ?? new Set<string>();
    jobIds.add(jobId);
    jobIdsBySkillName.set(skillName, jobIds);
  };

  for (const skillName of context.definition.skills ?? []) {
    addReference(skillName, WORKFLOW_LEVEL_SKILL_ORIGIN);
  }

  for (const job of context.jobs) {
    for (const skillName of extractYamlSkillNames(job.inputs)) {
      addReference(skillName, job.id);
    }
  }

  return jobIdsBySkillName;
}
