import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity({ name: 'scoped_ai_default' })
export class ScopedAiDefaultEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  // NULL = platform/global default. UNIQUE per non-null scope; the single
  // NULL-scope row is enforced at the repository layer (Postgres treats NULL
  // as distinct in a UNIQUE index).
  @Index({ unique: true })
  @Column({ name: 'scope_node_id', type: 'uuid', nullable: true })
  scopeNodeId!: string | null;

  @Column({ name: 'harness_id', type: 'text', nullable: true })
  harnessId!: string | null;

  @Column({ name: 'model_name', type: 'text', nullable: true })
  modelName!: string | null;

  @Column({ name: 'provider_name', type: 'text', nullable: true })
  providerName!: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
