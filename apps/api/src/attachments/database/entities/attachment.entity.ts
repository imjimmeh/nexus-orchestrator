import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AttachmentParseStatus } from '@nexus/core';

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  filename!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 255 })
  mime_type!: string;

  @Column({ name: 'size_bytes', type: 'integer' })
  size_bytes!: number;

  @Index('idx_attachments_checksum')
  @Column({ type: 'varchar', length: 64 })
  checksum!: string;

  @Column({ name: 'storage_key', type: 'varchar' })
  storage_key!: string;

  @Column({ name: 'parsed_key', type: 'varchar', nullable: true })
  parsed_key?: string | null;

  @Column({
    name: 'parse_status',
    type: 'varchar',
    length: 32,
    default: 'pending',
  })
  parse_status!: AttachmentParseStatus;

  @Column({ name: 'parse_error', type: 'text', nullable: true })
  parse_error?: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  created_by?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
