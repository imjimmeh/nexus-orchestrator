import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('llm_providers')
export class LlmProvider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', default: 'custom' })
  provider_id?: string;

  @Column({ default: 'api_key' })
  auth_type: string;

  @Column({ type: 'uuid', nullable: true })
  secret_id?: string | null;

  @Column({ type: 'jsonb', default: {} })
  runtime_env: Record<string, unknown>;

  @Column({ default: true })
  is_active: boolean;

  @Column({ default: 'global' })
  owner_type: string;

  @Column({ type: 'varchar', nullable: true })
  owner_id?: string | null;

  @Column({ type: 'varchar', nullable: true })
  oauth_authorization_url?: string | null;

  @Column({ type: 'varchar', nullable: true })
  oauth_token_url?: string | null;

  @Column({ type: 'varchar', nullable: true })
  oauth_client_id?: string | null;

  @Column({ type: 'uuid', nullable: true })
  oauth_client_secret_id?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  oauth_scopes?: string[] | null;

  @Column({ type: 'varchar', nullable: true })
  oauth_redirect_uri?: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
