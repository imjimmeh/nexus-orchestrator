import { ForbiddenException } from '@nestjs/common';

interface PolicyScope {
  projects?: string[];
  roles?: string[];
}

interface CallerScope {
  scopeNodeId?: string;
  role?: string;
}

export function assertMayUseHarness(
  caller: CallerScope,
  def: { policyScope: Record<string, unknown> },
): void {
  const scope = def.policyScope as PolicyScope;
  const projectOk =
    !scope.projects?.length ||
    (caller.scopeNodeId !== undefined &&
      scope.projects.includes(caller.scopeNodeId));
  const roleOk =
    !scope.roles?.length ||
    (caller.role !== undefined && scope.roles.includes(caller.role));
  if (!projectOk || !roleOk)
    throw new ForbiddenException('Harness use not permitted for this scope');
}
