interface PlanCarrier {
  id: string;
  execution_config?: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function extractTargetFiles(plan: unknown): Set<string> {
  const files = new Set<string>();
  const milestones = asRecord(plan)?.["milestones"];
  if (!Array.isArray(milestones)) return files;
  for (const milestone of milestones) {
    const tasks = asRecord(milestone)?.["tasks"];
    if (!Array.isArray(tasks)) continue;
    for (const task of tasks) {
      const targets = asRecord(task)?.["target_files"];
      if (!Array.isArray(targets)) continue;
      for (const file of targets) {
        if (typeof file === "string" && file.length > 0) files.add(file);
      }
    }
  }
  return files;
}

function planOf(item: PlanCarrier): unknown {
  return asRecord(item.execution_config)?.["implementationPlan"];
}

/**
 * Returns the id of the first in-flight item whose plan target_files overlap the
 * candidate's, or null when there is no contention.
 */
export function findTargetFileContention(
  candidate: PlanCarrier,
  inFlight: PlanCarrier[],
): string | null {
  const candidateFiles = extractTargetFiles(planOf(candidate));
  if (candidateFiles.size === 0) return null;

  for (const other of inFlight) {
    if (other.id === candidate.id) continue;
    const otherFiles = extractTargetFiles(planOf(other));
    for (const file of candidateFiles) {
      if (otherFiles.has(file)) return other.id;
    }
  }
  return null;
}
