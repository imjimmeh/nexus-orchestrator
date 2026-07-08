import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { MergeMethod, PullRequestState } from './merge-provider.interface';

/**
 * Neutral mapping from a hosted pull request identity
 * `(provider, owner, repo, pr_number)` back to the originating scope/context and
 * workflow run. The PR webhook / poll reconciler (Phase 4) looks the row up by
 * provider identity and emits the neutral `pr_merged` lifecycle event; no
 * downstream domain identifier ever crosses into this table.
 *
 * `github_secret_id` and `repository_url` let the poll reconciler (Phase 4) and
 * merge (Phase 5) resolve provider credentials/host from a bare `PullRequestRef`
 * without changing the pinned `MergeProvider` signatures: the provider looks the
 * row up by `(provider, owner, repo, pr_number)` and reads the secret id off it.
 *
 * Table created by
 * `apps/api/src/database/migrations/20260628000000-create-pull-request-tracking.ts`.
 */
@Entity('pull_request_tracking')
@Unique('uq_pull_request_tracking_provider_owner_repo_number', [
  'provider',
  'owner',
  'repo',
  'pr_number',
])
@Index('idx_pull_request_tracking_state', ['state'])
export class PullRequestTracking {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ type: 'varchar', length: 200 })
  owner!: string;

  @Column({ type: 'varchar', length: 200 })
  repo!: string;

  @Column({ name: 'pr_number', type: 'integer' })
  pr_number!: number;

  @Column({ name: 'scope_id', type: 'varchar', length: 200 })
  scope_id!: string;

  @Column({ name: 'context_id', type: 'varchar', length: 200 })
  context_id!: string;

  @Column({ name: 'workflow_run_id', type: 'uuid' })
  workflow_run_id!: string;

  @Column({ name: 'head_branch', type: 'varchar', length: 400 })
  head_branch!: string;

  @Column({ name: 'base_branch', type: 'varchar', length: 400 })
  base_branch!: string;

  @Column({ name: 'pr_url', type: 'text' })
  pr_url!: string;

  @Column({ name: 'github_secret_id', type: 'varchar', length: 200 })
  github_secret_id!: string;

  @Column({ name: 'repository_url', type: 'text' })
  repository_url!: string;

  @Column({ type: 'varchar', length: 16 })
  state!: PullRequestState;

  @Column({
    name: 'merge_commit_sha',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  merge_commit_sha!: string | null;

  @Column({ name: 'auto_merge', type: 'boolean', default: false })
  auto_merge!: boolean;

  @Column({
    name: 'merge_method',
    type: 'varchar',
    length: 16,
    default: 'merge',
  })
  merge_method!: MergeMethod;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updated_at!: Date;
}
