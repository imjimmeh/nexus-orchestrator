import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type {
  PostedQuestion,
  SubmittedAnswer,
  UserQuestionAwaitStatus,
  UserQuestionDeliveryChannel,
} from './user-question-await.entity.types';

export type {
  PostedQuestion,
  SubmittedAnswer,
  UserQuestionAwaitStatus,
  UserQuestionDeliveryChannel,
} from './user-question-await.entity.types';

/**
 * Durable record of an ask_user_questions interaction. The agent blocks (or
 * its container is torn down) while this row is `pending`; answer delivery is
 * keyed off this row — never off in-memory or socket state — so the
 * interaction survives API restarts and container death.
 */
@Entity('user_question_awaits')
export class UserQuestionAwait {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  workflow_run_id: string;

  /** Job that posed the question — the job to resume on fallback delivery. */
  @Column({ type: 'varchar', length: 255 })
  job_id: string;

  /** Step that posed the question — targets the WS fast path. */
  @Column({ type: 'varchar', length: 255 })
  step_id: string;

  @Column({ type: 'jsonb' })
  questions: PostedQuestion[];

  @Column({ type: 'jsonb', nullable: true })
  answers: SubmittedAnswer[] | null;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status: UserQuestionAwaitStatus;

  @Column({ type: 'varchar', length: 16, nullable: true })
  delivered_via: UserQuestionDeliveryChannel | null;

  @Column({ type: 'timestamp', nullable: true })
  answered_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
