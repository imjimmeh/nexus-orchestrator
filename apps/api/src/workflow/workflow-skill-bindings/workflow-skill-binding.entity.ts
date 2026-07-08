import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Runtime skill -> (workflow | workflow step) assignment, recorded
 * separately from `workflows.yaml_definition` so a workflow reseed never
 * clobbers assignments made by the self-improvement pipeline.
 *
 * `step_id: null` means the binding applies to the whole workflow rather
 * than a single step. The true uniqueness constraint on
 * `(workflow_name, COALESCE(step_id, ''), skill_name)` is an expression
 * index created in the migration
 * (`apps/api/src/database/migrations/20260714000000-create-workflow-skill-bindings.ts`)
 * — TypeORM's `@Index`/`@Unique` decorators cannot express a `COALESCE`
 * expression, so it is intentionally not mirrored here.
 */
@Entity('workflow_skill_bindings')
@Index('idx_workflow_skill_bindings_workflow_name', ['workflow_name'])
export class WorkflowSkillBinding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_name', type: 'varchar', length: 200 })
  workflow_name!: string;

  @Column({ name: 'step_id', type: 'varchar', length: 200, nullable: true })
  step_id!: string | null;

  @Column({ name: 'skill_name', type: 'varchar', length: 200 })
  skill_name!: string;

  @Column({ type: 'jsonb', nullable: true })
  provenance!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updated_at!: Date;
}
