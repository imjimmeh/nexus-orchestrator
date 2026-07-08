import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AttachmentOwnerType } from '@nexus/core';

@Entity('attachment_links')
@Index('UQ_attachment_link', ['attachment_id', 'owner_type', 'owner_id'], {
  unique: true,
})
@Index('idx_attachment_links_owner', ['owner_type', 'owner_id'])
export class AttachmentLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'attachment_id', type: 'uuid' })
  attachment_id!: string;

  @Column({ name: 'owner_type', type: 'varchar', length: 64 })
  owner_type!: AttachmentOwnerType;

  @Column({ name: 'owner_id', type: 'varchar' })
  owner_id!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
