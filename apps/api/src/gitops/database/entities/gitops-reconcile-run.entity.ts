import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('gitops_reconcile_runs')
export class GitOpsReconcileRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'binding_id', type: 'uuid' })
  bindingId: string;

  @Column({ type: 'text' })
  direction: string;

  @Column({ type: 'text', default: 'pending' })
  status: string;

  @Column({ type: 'text' })
  revision: string;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  errors: Array<Record<string, unknown>>;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
