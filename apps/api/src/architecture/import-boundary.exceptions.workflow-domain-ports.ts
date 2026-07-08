import type { ImportBoundarySeedRow } from './import-boundary.types';

/**
 * Cross-domain exception rows for control-plane (workflow) importing from the project domain.
 * Split from import-boundary.exceptions.ts to keep each file under the max-lines limit.
 */
export const workflowDomainPortsExceptionRows: ReadonlyArray<ImportBoundarySeedRow> =
  [
    [
      'workflow/domain-ports/workflow-domain-ports.module.ts',
      'session/session.module.ts',
      'control-plane',
      'chat-domain',
    ],
  ];
