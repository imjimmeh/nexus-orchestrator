import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IMcpServer, McpServerStatus, McpTransportType } from '@nexus/core';

@Entity('mcp_servers')
@Index('idx_mcp_servers_enabled', ['enabled'])
@Index('idx_mcp_servers_last_status', ['last_status'])
export class McpServer implements IMcpServer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  name: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({
    type: 'enum',
    enum: McpTransportType,
  })
  transport_type: McpTransportType;

  @Column({ type: 'text', nullable: true })
  command?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  args?: string[] | null;

  @Column({ type: 'text', nullable: true })
  url?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  headers?: Record<string, string> | null;

  /**
   * Direct UUID FK to `secret_store.id`. The decrypted JSON payload is
   * merged into the outgoing `headers` map at request time. Takes
   * precedence over the plaintext `headers` column.
   */
  @Column({ type: 'uuid', nullable: true })
  headers_secret_id?: string | null;

  /**
   * Plaintext environment variables merged onto `process.env` when the
   * stdio child process is spawned. Only valid when `transport_type`
   * is `'stdio'`.
   */
  @Column({ type: 'jsonb', nullable: true })
  env?: Record<string, string> | null;

  /**
   * Direct UUID FK to `secret_store.id`. The decrypted JSON payload is
   * merged onto the spawned child process's environment (overlaying
   * `process.env`). Takes precedence over the plaintext `env` column.
   * Only valid when `transport_type` is `'stdio'`.
   */
  @Column({ type: 'uuid', nullable: true })
  env_secret_id?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  include_tools?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  exclude_tools?: string[] | null;

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
    enum: McpServerStatus,
    default: McpServerStatus.UNKNOWN,
  })
  last_status: McpServerStatus;

  @Column({ type: 'text', nullable: true })
  last_error?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_connected_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_discovered_at?: Date | null;

  @Column({ type: 'int', nullable: true })
  last_discovered_tool_count?: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
