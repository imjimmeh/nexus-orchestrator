import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('subagent_details')
export class SubagentDetails {
  /** Equals the shared execution id — 1:1 satellite key, not generated. */
  @PrimaryColumn('uuid')
  execution_id!: string;

  // Matches subagent_executions.parent_container_id (default varchar(255)) so
  // the future backfill is a lossless straight copy with no truncation.
  @Column({ type: 'varchar', length: 255 })
  parent_container_id!: string;

  @Column({ type: 'uuid', nullable: true })
  delegation_contract_id?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lineage_trace_id?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lineage_parent_trace_id?: string | null;

  @Column({ type: 'int', default: 0 })
  depth!: number;

  @Column({ type: 'jsonb', nullable: true })
  assigned_files?: string[] | null;

  // Stored as varchar to mirror subagent_executions.parent_session_tree_id
  // (legacy values are not guaranteed valid UUIDs), keeping the backfill cast-free.
  @Column({ type: 'varchar', length: 255, nullable: true })
  parent_session_tree_id?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  result?: Record<string, unknown> | null;

  /** Step role that spawned this subagent — pairs with parent_container_id for the uniqueness guard. */
  @Column({ type: 'varchar', nullable: true })
  role?: string | null;

  /**
   * Cleared (set to false) when the subagent reaches a terminal state.
   * Enables the DB partial-unique index that enforces at-most-one active
   * subagent per (parent_container_id, role).
   */
  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
