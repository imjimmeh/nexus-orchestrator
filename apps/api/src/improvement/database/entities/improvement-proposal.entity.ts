import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  ImprovementProposalKind,
  ImprovementProposalStatus,
} from '@nexus/core';
import type { ImprovementEvidencePayload } from './improvement-proposal.entity.types';

@Entity('improvement_proposals')
@Index('idx_improvement_proposals_kind_status', ['kind', 'status'])
@Index('idx_improvement_proposals_status_created_at', ['status', 'created_at'])
export class ImprovementProposal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 48 })
  kind!: ImprovementProposalKind;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: ImprovementProposalStatus;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  evidence!: ImprovementEvidencePayload;

  @Column({ type: 'double precision', default: 0 })
  confidence!: number;

  @Column({ type: 'jsonb', nullable: true })
  rollback_data!: Record<string, unknown> | null;

  @Column({ type: 'integer', default: 1 })
  occurrence_count!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  provenance!: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  applied_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  rolled_back_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
