import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('inception_chat_messages')
export class InceptionChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'session_id' })
  sessionId: string;

  @Column({ name: 'scope_id' })
  scopeId: string;

  @Column({ type: 'varchar', length: 10 })
  role: 'user' | 'agent';

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
