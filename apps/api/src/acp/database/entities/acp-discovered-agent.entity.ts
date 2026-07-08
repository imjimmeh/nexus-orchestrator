import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IAcpDiscoveredAgent } from '@nexus/core';
import { AcpServer } from './acp-server.entity';

@Entity('acp_discovered_agents')
@Index('idx_acp_discovered_agents_server_id', ['server_id'])
@Index('idx_acp_discovered_agents_registry_tool_name', ['registry_tool_name'])
export class AcpDiscoveredAgent implements IAcpDiscoveredAgent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  server_id: string;

  @ManyToOne(() => AcpServer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'server_id' })
  server: AcpServer;

  @Column({ type: 'varchar', length: 63 })
  agent_name: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  input_content_types?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  output_content_types?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  manifest_metadata?: Record<string, unknown> | null;

  @Column({ type: 'varchar', unique: true, nullable: true })
  registry_tool_name?: string | null;

  @Column({ type: 'boolean', default: false })
  is_registered: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
