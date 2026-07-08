import { isRecord } from '@nexus/core';

/**
 * Extracts the YAML-declared skill name list from a job/step's `inputs`
 * bag (`inputs.skills: [name, ...]`, Epic B Task 5). `inputs` remains an
 * untyped `Record<string, unknown>` across the workflow engine, so this is
 * the single shared, defensive accessor both the deep validator
 * (`validation/workflow-validation.skill-rules.ts`) and the step-execution
 * skill resolver (`workflow-step-execution/step-agent-step-executor.service.ts`)
 * use, rather than each re-deriving its own ad hoc extraction.
 *
 * `WorkflowParserService.validateSkillsShape` already rejects a malformed
 * `inputs.skills` at parse time, so by the time this runs the value is
 * either absent or a clean `string[]` — the runtime guards here are a
 * defensive backstop, not the primary validation.
 */
export function extractYamlSkillNames(inputs: unknown): string[] {
  if (!isRecord(inputs)) {
    return [];
  }

  const { skills } = inputs;
  if (!Array.isArray(skills)) {
    return [];
  }

  return skills.filter(
    (name): name is string =>
      typeof name === 'string' && name.trim().length > 0,
  );
}
