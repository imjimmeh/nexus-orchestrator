import type {
  ImportBoundaryException,
  ImportBoundarySeedRow,
} from './import-boundary.types';
import { workflowDomainPortsExceptionRows } from './import-boundary.exceptions.workflow-domain-ports';

const SHARED_EXCEPTION_REASON =
  'Legacy in-process coupling approved for phase-1 split guardrails.';
const SHARED_EXCEPTION_OWNER = 'EPIC-090';
const SHARED_EXCEPTION_EXPIRY = '2026-09-30';

const seedRows: ReadonlyArray<ImportBoundarySeedRow> = [
  [
    'workflow/workflow.module.ts',
    'session/session.module.ts',
    'control-plane',
    'chat-domain',
  ],
  [
    'workflow/workflow-interruption-recovery/workflow-interruption-recovery.module.ts',
    'session/session.module.ts',
    'control-plane',
    'chat-domain',
  ],
  [
    'workflow/domain-ports/in-process-chat-session-domain.adapter.ts',
    'session/session-hydration.service.ts',
    'control-plane',
    'chat-domain',
  ],
  [
    'workflow/workflow-runtime/workflow-runtime.module.ts',
    'session/session.module.ts',
    'control-plane',
    'chat-domain',
  ],
  [
    'workflow/workflow-await/workflow-await.module.ts',
    'session/session.module.ts',
    'control-plane',
    'chat-domain',
  ],
  [
    'workflow/workflow-run-operations/workflow-run-operations.module.ts',
    'session/session.module.ts',
    'control-plane',
    'chat-domain',
  ],
  [
    'workflow/workflow-step-execution/workflow-step-execution.module.ts',
    'session/session.module.ts',
    'control-plane',
    'chat-domain',
  ],
  [
    'workflow/workflow-core.module.ts',
    'session/session.module.ts',
    'control-plane',
    'chat-domain',
  ],
  ...workflowDomainPortsExceptionRows,
];

export const temporaryImportBoundaryExceptions: ReadonlyArray<ImportBoundaryException> =
  seedRows.map(([sourceFile, targetFile, fromDomain, toDomain]) => ({
    sourceFile,
    targetFile,
    fromDomain,
    toDomain,
    reason: SHARED_EXCEPTION_REASON,
    owner: SHARED_EXCEPTION_OWNER,
    expiresOn: SHARED_EXCEPTION_EXPIRY,
  }));
