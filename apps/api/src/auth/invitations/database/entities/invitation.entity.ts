import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InvitationStatus } from '../../invitation.status.types';

@Entity('invitations')
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'token_hash', select: false })
  tokenHash: string;

  @Column({ name: 'scope_node_id', type: 'uuid' })
  scopeNodeId: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @Column({ type: 'varchar', length: 320, nullable: true })
  email: string | null;

  @Column({ name: 'invited_by_user_id', type: 'uuid' })
  invitedByUserId: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 16,
    default: InvitationStatus.Pending,
  })
  status: InvitationStatus;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @Column({ name: 'accepted_by_user_id', type: 'uuid', nullable: true })
  acceptedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
