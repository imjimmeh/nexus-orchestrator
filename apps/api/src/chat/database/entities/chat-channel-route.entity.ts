import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('chat_channel_routes')
@Index(
  'idx_chat_channel_routes_identity_unique',
  ['provider', 'external_thread_id', 'external_user_id'],
  { unique: true },
)
@Index('idx_chat_channel_routes_active_session', ['active_chat_session_id'])
export class ChatChannelRoute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  provider: string;

  @Column({ type: 'varchar', length: 128 })
  external_thread_id: string;

  @Column({ type: 'varchar', length: 128 })
  external_user_id: string;

  @Column({ type: 'uuid' })
  active_chat_session_id: string;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  last_accessed_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
