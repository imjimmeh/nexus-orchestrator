import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  IAcpServer,
  AcpServerStatus,
  AcpAuthType,
  AcpRunMode,
  AcpAwaitPolicy,
} from '@nexus/core';

@Entity('acp_servers')
@Index('idx_acp_servers_enabled', ['enabled'])
@Index('idx_acp_servers_last_status', ['last_status'])
export class AcpServer implements IAcpServer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  name: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'text' })
  url: string;

  @Column({
    type: 'enum',
    enum: AcpAuthType,
    default: AcpAuthType.NONE,
  })
  auth_type: AcpAuthType;

  @Column({ type: 'text', nullable: true })
  auth_token?: string | null;

  /**
   * Direct UUID FK to `secret_store.id` whose decrypted JSON payload
   * supplies the `auth_token` value at request time. Takes precedence
   * over the plaintext `auth_token` column.
   */
  @Column({ type: 'uuid', nullable: true })
  auth_secret_id?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  headers?: Record<string, string> | null;

  /**
   * Direct UUID FK to `secret_store.id`. The decrypted JSON payload is
   * merged into the outgoing `headers` map at request time. Takes
   * precedence over the plaintext `headers` column.
   */
  @Column({ type: 'uuid', nullable: true })
  headers_secret_id?: string | null;

  @Column({ type: 'int', default: 30000 })
  timeout_ms: number;

  @Column({ type: 'int', default: 10000 })
  connect_timeout_ms: number;

  @Column({ type: 'int', default: 2 })
  max_retries: number;

  @Column({ type: 'int', default: 1000 })
  retry_backoff_ms: number;

  @Column({
    type: 'enum',
    enum: AcpRunMode,
    default: AcpRunMode.ASYNC,
  })
  default_run_mode: AcpRunMode;

  @Column({
    type: 'enum',
    enum: AcpAwaitPolicy,
    default: AcpAwaitPolicy.SURFACE_TO_USER,
  })
  await_policy: AcpAwaitPolicy;

  @Column({ type: 'jsonb', nullable: true })
  include_agents?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  exclude_agents?: string[] | null;

  @Column({
    type: 'enum',
    enum: AcpServerStatus,
    default: AcpServerStatus.UNKNOWN,
  })
  last_status: AcpServerStatus;

  @Column({ type: 'text', nullable: true })
  last_error?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_connected_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_discovered_at?: Date | null;

  @Column({ type: 'int', nullable: true })
  last_discovered_agent_count?: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
