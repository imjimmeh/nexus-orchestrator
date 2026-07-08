import type { IJob } from '@nexus/core';
import { asRecord } from '@nexus/core';
import { normalizeXmlArrayArtifacts } from '../xml-array-artifact.helpers';
import type { SpecialStepInputResolution } from './special-step-input-resolver.types';

/**
 * Resolve the merged input map for a step, honoring optional `switch` branches
 * and the trailing `default` fallback. Returns the base `inputs` when the step
 * does not declare a `switch`. Throws when a `switch` is declared but no branch
 * matches and there is no default.
 */
export function resolveSwitchCaseInputs(
  step: IJob,
  templateVariables: Record<string, unknown>,
  resolution: SpecialStepInputResolution,
): Record<string, unknown> {
  const baseInputs = asRecord(step.inputs);
  if (!Array.isArray(step.switch) || step.switch.length === 0) {
    return baseInputs;
  }

  const matchedInputs = findMatchedSwitchBranchInputs(
    step,
    templateVariables,
    resolution,
  );
  if (matchedInputs) {
    return { ...baseInputs, ...matchedInputs };
  }

  if (step.default?.inputs) {
    return { ...baseInputs, ...step.default.inputs };
  }

  throw new TypeError(`No switch case matched for job ${step.id}`);
}

function findMatchedSwitchBranchInputs(
  step: IJob,
  templateVariables: Record<string, unknown>,
  resolution: SpecialStepInputResolution,
): Record<string, unknown> | null {
  const branches = Array.isArray(step.switch) ? step.switch : [];
  for (const branch of branches) {
    if (
      !isSwitchBranchCaseMatched(branch?.case, templateVariables, resolution)
    ) {
      continue;
    }
    return asRecord(branch?.inputs);
  }
  return null;
}

function isSwitchBranchCaseMatched(
  branchCase: unknown,
  templateVariables: Record<string, unknown>,
  resolution: SpecialStepInputResolution,
): boolean {
  if (typeof branchCase !== 'string') {
    return false;
  }

  const condition = resolution.resolveJobInputs(
    { condition: branchCase },
    templateVariables,
  ).condition;

  return condition === true || condition === 'true';
}

/**
 * Resolve the items array for a `for_each` step, applying the same XML-array
 * artifact normalization the executor used inline. Throws when the resolved
 * value is not an array.
 */
export function resolveForEachItems(
  step: IJob,
  templateVariables: Record<string, unknown>,
  resolution: SpecialStepInputResolution,
): unknown[] {
  if (typeof step.for_each !== 'string') {
    return [];
  }

  const resolved = normalizeXmlArrayArtifacts(
    resolution.resolveJobInputs({ items: step.for_each }, templateVariables)
      .items,
  );

  if (!Array.isArray(resolved)) {
    throw new TypeError(
      `for_each expression must resolve to array, got: ${typeof resolved}`,
    );
  }

  return resolved;
}
