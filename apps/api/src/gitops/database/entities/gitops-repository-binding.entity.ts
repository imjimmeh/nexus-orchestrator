import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  type GitOpsBindingSyncMode,
  type GitOpsSyncableObjectType,
} from '@nexus/core';

@Entity('gitops_repository_bindings')
export class GitOpsRepositoryBinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'scope_node_id', type: 'uuid' })
  scopeNodeId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'repo_url', type: 'text' })
  repoUrl: string;

  @Column({ name: 'default_ref', type: 'text', default: 'main' })
  defaultRef: string;

  @Column({ name: 'root_path', type: 'text', default: '.' })
  rootPath: string;

  @Column({ name: 'sync_mode', type: 'text' })
  syncMode: GitOpsBindingSyncMode;

  /**
   * Load-bearing reference to the secret-store credential
   * that authenticates the binding's remote git operations
   * (HTTPS basic-auth / token, or SSH private key, depending
   * on the secret's `kind`).
   *
   * The column is consumed by
   * `apps/api/src/gitops/gitops-credentials-resolver.service.ts`
   * (`GitOpsCredentialsResolver`) and the resolved value is
   * applied to the `git` CLI invocations issued by
   * `GitOpsOutboundSyncService` (push) and
   * `DesiredStateLoaderService` (inbound fetch/clone) via
   * `apps/api/src/gitops/gitops-invocation-builder.ts`
   * (`GitOpsInvocationBuilder`).
   *
   * When `null` the binding operates in anonymous mode (or
   * fails fast under strict mode — see
   * `GITOPS_REQUIRE_CREDENTIALS`).
   */
  @Column({ name: 'credentials_secret_id', type: 'uuid', nullable: true })
  credentialsSecretId: string | null;

  @Column({ type: 'boolean', default: true })
  enabled = true;

  @Column({
    name: 'included_object_types',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  includedObjectTypes: GitOpsSyncableObjectType[];

  @Column({ name: 'conflict_policy', type: 'text', default: 'require_review' })
  conflictPolicy: string;

  @Column({ name: 'last_applied_revision', type: 'text', nullable: true })
  lastAppliedRevision: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
