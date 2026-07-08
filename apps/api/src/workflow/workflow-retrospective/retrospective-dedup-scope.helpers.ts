/**
 * Collaborator-parameterized helpers for FU-16 (config-gated dedup scope
 * widening). Extracted from `RetrospectiveAnalysisService.isAlreadyKnown`
 * purely to keep that orchestrator under the project's per-file line budget.
 */
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { RetrospectiveDedupIdentity } from './retrospective-analysis.types';
import {
  RETROSPECTIVE_DEDUP_WIDEN_SCOPE_DEFAULT,
  RETROSPECTIVE_DEDUP_WIDEN_SCOPE_SETTING,
} from './retrospective-dedup-scope.settings.constants';

/**
 * FU-16 kill switch read: defaults to OFF and is fail-soft (a settings-lookup
 * error yields the OFF default rather than throwing).
 */
export async function resolveDedupWidenScope(
  settings: Pick<SystemSettingsService, 'get'>,
): Promise<boolean> {
  try {
    return await settings.get<boolean>(
      RETROSPECTIVE_DEDUP_WIDEN_SCOPE_SETTING,
      RETROSPECTIVE_DEDUP_WIDEN_SCOPE_DEFAULT,
    );
  } catch {
    return RETROSPECTIVE_DEDUP_WIDEN_SCOPE_DEFAULT;
  }
}

/**
 * When `widenScope` is false, always returns `{}` (the current, unwidened
 * project+global-only dedup pool). When true, returns only the identity
 * fields that were actually supplied — never an explicit `undefined` key —
 * so `MemoryRetrievalService.fetchCandidateSegments`'s truthy gate sees a
 * clean absence rather than a present-but-undefined field.
 */
export function buildDedupScopeFields(
  widenScope: boolean,
  identity: RetrospectiveDedupIdentity,
): RetrospectiveDedupIdentity {
  if (!widenScope) {
    return {};
  }
  const fields: RetrospectiveDedupIdentity = {};
  if (identity.agentProfileName) {
    fields.agentProfileName = identity.agentProfileName;
  }
  if (identity.workflowName) {
    fields.workflowName = identity.workflowName;
  }
  return fields;
}
