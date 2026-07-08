import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('provider_oauth_sessions')
export class ProviderOAuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  provider_id: string;

  @Column({ type: 'varchar', length: 128 })
  state_hash: string;

  @Column({ type: 'text', select: false })
  code_verifier: string;

  @Column({ type: 'varchar', length: 2048 })
  redirect_uri: string;

  @Column({ length: 32, default: 'global' })
  owner_type: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  owner_id?: string | null;

  @Column({ type: 'timestamp' })
  expires_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  used_at?: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
