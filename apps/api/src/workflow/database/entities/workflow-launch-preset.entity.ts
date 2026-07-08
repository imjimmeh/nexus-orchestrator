import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('workflow_launch_presets')
@Index('idx_workflow_launch_presets_workflow_scope', ['workflow_id', 'scopeId'])
@Index('idx_workflow_launch_presets_workflow_name', ['workflow_id', 'name'])
export class WorkflowLaunchPreset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  workflow_id: string;

  @Column({ name: 'scope_id', type: 'varchar', length: 255, nullable: true })
  scopeId: string | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'jsonb', default: {} })
  trigger_data: Record<string, unknown>;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updated_by: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
