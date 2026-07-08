import { z } from 'zod';
import {
  GITOPS_BINDING_SYNC_MODES,
  GITOPS_SYNCABLE_OBJECT_TYPES,
} from '@nexus/core';

export const gitOpsRepositoryBindingIdSchema = z.string().uuid();

/**
 * `credentialsSecretId` is a **load-bearing** field. It is
 * resolved by
 * `apps/api/src/gitops/gitops-credentials-resolver.service.ts`
 * (`GitOpsCredentialsResolver`) and the resolved value is
 * applied to the `git` CLI invocations issued by
 * `GitOpsOutboundSyncService` (push) and
 * `DesiredStateLoaderService` (inbound fetch/clone) via
 * `apps/api/src/gitops/gitops-invocation-builder.ts`
 * (`GitOpsInvocationBuilder`).
 *
 * The field was previously a no-op — the column existed on
 * the entity but no service ever read it. As of WI-2026-061
 * the column participates in every credentialed git fetch /
 * clone / push. The DTO schema accepts `null` (anonymous
 * mode) or a UUID referencing a `secret_store` row whose
 * decrypted payload is an HTTPS credential pair (`username`
 * + `password` / `token`) or an SSH private key string.
 */
export const createGitOpsRepositoryBindingSchema = z.object({
  scopeNodeId: z.string().uuid(),
  name: z.string().min(1),
  repoUrl: z.string().url(),
  defaultRef: z.string().min(1).default('main'),
  rootPath: z.string().min(1).default('.'),
  syncMode: z.enum(GITOPS_BINDING_SYNC_MODES),
  credentialsSecretId: z.string().uuid().nullable().optional(),
  includedObjectTypes: z.array(z.enum(GITOPS_SYNCABLE_OBJECT_TYPES)).min(1),
});

export const updateGitOpsRepositoryBindingSchema = z.object({
  name: z.string().min(1).optional(),
  repoUrl: z.string().url().optional(),
  defaultRef: z.string().min(1).optional(),
  rootPath: z.string().min(1).optional(),
  syncMode: z.enum(GITOPS_BINDING_SYNC_MODES).optional(),
  credentialsSecretId: z.string().uuid().nullable().optional(),
  includedObjectTypes: z
    .array(z.enum(GITOPS_SYNCABLE_OBJECT_TYPES))
    .min(1)
    .optional(),
});

export const listGitOpsRepositoryBindingsQuerySchema = z.object({
  scopeNodeId: z.string().uuid(),
});
