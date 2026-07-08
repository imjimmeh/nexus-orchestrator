import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowEventDedupe } from '../entities/workflow-event-dedupe.entity';

@Injectable()
export class WorkflowEventDedupeRepository {
  constructor(
    @InjectRepository(WorkflowEventDedupe)
    private readonly repo: Repository<WorkflowEventDedupe>,
  ) {}

  /**
   * Attempt to claim a dedupe key. Returns true if the key was newly inserted
   * (the caller should process the event), or false if it already existed
   * within the retention window (the caller should skip).
   */
  async claim(key: string, now: Date): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .values({ dedupe_key: key, created_at: now })
      .orIgnore()
      .execute();
    return (result.identifiers?.length ?? 0) > 0;
  }

  /**
   * Remove all dedupe records whose created_at is older than the given date.
   * Call this periodically to prevent unbounded table growth.
   */
  async purgeExpired(before: Date): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .delete()
      .where('created_at < :before', { before })
      .execute();
  }
}
