import type { VariableResolverService } from '../variables/variable-resolver.service';

/**
 * Build the initial state_variables for a new workflow run, snapshotting the
 * effective variables for the trigger scope under `vars`. The snapshot is taken
 * once at launch so a running workflow sees a consistent policy even if a
 * variable is edited mid-run; new values apply to the next run.
 */
export async function buildInitialStateVariables(
  triggerData: Record<string, unknown>,
  resolver: VariableResolverService,
): Promise<Record<string, unknown>> {
  const scopeId =
    typeof triggerData.scopeId === 'string' && triggerData.scopeId.trim()
      ? triggerData.scopeId.trim()
      : null;
  const vars = await resolver.resolveContext(scopeId);
  return { trigger: triggerData, vars };
}
