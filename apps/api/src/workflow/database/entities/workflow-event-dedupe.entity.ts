import { CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'workflow_event_dedupe' })
export class WorkflowEventDedupe {
  @PrimaryColumn({ type: 'varchar', length: 512 })
  @Index({ unique: true })
  dedupe_key!: string;

  @CreateDateColumn()
  @Index()
  created_at!: Date;
}
