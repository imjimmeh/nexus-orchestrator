import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import { normalizeSkillName } from '../workflow-stage-skill-policy.helpers';
import type { WorkflowSkillBinding } from '../workflow-skill-bindings/workflow-skill-binding.entity';
import { resolveEffectiveSkills } from './effective-skills.helpers';
import type { EffectiveSkill } from './effective-skills.types';
import type { ResolveAgentAssignedSkillsParams } from './agent-assigned-skills.types';

/**
 * Single shared entry point BOTH the step-execution and subagent-provisioning
 * paths call to compute an agent's effective, hydrated skill set.
 *
 * Fetches runtime workflow-skill bindings, partitions them into
 * workflow-scoped (`step_id === null`) and step-scoped (`step_id === stepId`)
 * name lists, unions them with the caller's already-resolved profile skills
 * and YAML-declared skills via the pure `resolveEffectiveSkills` helper
 * (Task 3), then hydrates each resulting name back to a full
 * `SkillLibraryRecord` — preferring the caller's own profile-skill records
 * (already scope-resolved) and falling back to the full skill catalog for
 * names that only came from a binding or YAML declaration.
 *
 * This is the fix for the recurring "step vs subagent path divergence" bug:
 * both call sites must invoke this exact function rather than re-implementing
 * their own gather-and-union logic.
 */
export async function resolveAgentAssignedSkills(
  params: ResolveAgentAssignedSkillsParams,
): Promise<SkillLibraryRecord[]> {
  const bindings = params.workflowName
    ? await params.workflowSkillBindings.listForWorkflow(params.workflowName)
    : [];

  const workflowBindingNames = bindings
    .filter((binding) => binding.step_id === null)
    .map((binding) => binding.skill_name);
  const stepBindingNames = params.stepId
    ? bindings
        .filter((binding) => binding.step_id === params.stepId)
        .map((binding) => binding.skill_name)
    : [];

  const effectiveSkills = resolveEffectiveSkills({
    profileSkills: params.profileSkills.map((skill) => skill.name),
    workflowYamlSkills: params.workflowYamlSkills ?? [],
    stepYamlSkills: params.stepYamlSkills ?? [],
    workflowBindings: workflowBindingNames,
    stepBindings: stepBindingNames,
  });

  const recordByName = shouldSkipSkillCatalogScan({
    bindings,
    effectiveSkills,
    profileSkills: params.profileSkills,
  })
    ? buildSkillRecordLookup([params.profileSkills])
    : buildSkillRecordLookup([
        params.profileSkills,
        params.skillCatalog.listSkills(),
      ]);

  return effectiveSkills
    .map((skill) => recordByName.get(normalizeSkillName(skill.name)))
    .filter((record): record is SkillLibraryRecord => record !== undefined);
}

/**
 * True when the (uncached, `readdirSync`-backed) skill-library scan can be
 * skipped entirely: there are no runtime bindings AND every effective skill
 * name is already covered by the caller's already-hydrated profile-skill
 * records. In that case the profile records alone hydrate the full,
 * correct set — the catalog scan would only re-derive names this function
 * already has records for. Any effective name NOT covered by profile
 * records (e.g. a workflow/step YAML skill absent from the profile) forces
 * the full scan so hydration never silently drops a skill.
 */
function shouldSkipSkillCatalogScan(params: {
  bindings: WorkflowSkillBinding[];
  effectiveSkills: EffectiveSkill[];
  profileSkills: SkillLibraryRecord[];
}): boolean {
  if (params.bindings.length > 0) {
    return false;
  }
  const profileNames = new Set(
    params.profileSkills.map((skill) => normalizeSkillName(skill.name)),
  );
  return params.effectiveSkills.every((skill) =>
    profileNames.has(normalizeSkillName(skill.name)),
  );
}

/**
 * Builds a name->record lookup from multiple skill-record sources, in
 * priority order: the first source a name appears in wins.
 */
function buildSkillRecordLookup(
  sources: SkillLibraryRecord[][],
): Map<string, SkillLibraryRecord> {
  const recordByName = new Map<string, SkillLibraryRecord>();
  for (const source of sources) {
    for (const skill of source) {
      const key = normalizeSkillName(skill.name);
      if (!recordByName.has(key)) {
        recordByName.set(key, skill);
      }
    }
  }
  return recordByName;
}
