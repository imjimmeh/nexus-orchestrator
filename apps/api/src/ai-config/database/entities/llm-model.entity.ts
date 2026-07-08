import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('llm_models')
export class LlmModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  provider_name?: string | null;

  @Column({ type: 'int', default: 128000 })
  token_limit: number;

  @Column({
    name: 'input_token_cents_per_million',
    type: 'integer',
    nullable: true,
  })
  input_token_cents_per_million?: number | null;

  @Column({
    name: 'output_token_cents_per_million',
    type: 'integer',
    nullable: true,
  })
  output_token_cents_per_million?: number | null;

  @Column({ default: false })
  default_for_execution: boolean;

  @Column({ default: false })
  default_for_distillation: boolean;

  @Column({ default: false })
  default_for_summarization: boolean;

  @Column({ default: false })
  default_for_session: boolean;

  @Column({ name: 'supports_vision', type: 'boolean', default: false })
  supports_vision: boolean;

  @Column({ name: 'supports_embedding', type: 'boolean', default: false })
  supports_embedding: boolean;

  @Column({ name: 'embedding_dimension', type: 'int', nullable: true })
  embedding_dimension: number | null;

  @Column({ name: 'default_for_embedding', type: 'boolean', default: false })
  default_for_embedding: boolean;

  @Column({ type: 'varchar', nullable: true })
  default_thinking_level: string | null;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
