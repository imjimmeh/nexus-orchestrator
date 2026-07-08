import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_channel_identities')
@Unique('uq_user_channel_identities_user_channel_external', [
  'userId',
  'channel',
  'externalUserId',
])
@Index('idx_user_channel_identities_notifications_dest', {
  synchronize: false,
})
export class UserChannelIdentity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 64 })
  channel!: string;

  @Column({ name: 'external_user_id', type: 'varchar', length: 128 })
  externalUserId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  label!: string | null;

  @Column({ name: 'is_verified', type: 'boolean', default: false })
  isVerified!: boolean;

  @Column({
    name: 'is_notifications_destination',
    type: 'boolean',
    default: false,
  })
  isNotificationsDestination!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
