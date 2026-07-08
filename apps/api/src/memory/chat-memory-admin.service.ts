import { Injectable } from '@nestjs/common';
import { ChatMemoryEventRepository } from '../chat/database/repositories/chat-memory-event.repository';
import { ChatMemoryJobRepository } from '../chat/database/repositories/chat-memory-job.repository';
import { ChatProfileMemoryRepository } from '../chat/database/repositories/chat-profile-memory.repository';
import { ChatSessionMemoryRepository } from '../chat/database/repositories/chat-session-memory.repository';
import type { MemoryType } from './memory-backend.types';
import type { ChatMemorySource } from './dto/list-chat-memory-segments.dto';

/**
 * Narrow type for chat-only memory segments. Chat memory does not yet
 * support `strategic_intent` (which lives in the broader agent memory
 * system) so we narrow at the admin boundary before dispatching to the
 * chat repositories.
 */
type ChatMemoryType = Exclude<MemoryType, 'strategic_intent'>;

function toChatMemoryType(
  value: MemoryType | undefined,
): ChatMemoryType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'strategic_intent') {
    // `strategic_intent` lives in the broader agent memory system; chat
    // memory never carries it. Treat as "no filter" so the listing still
    // succeeds when the value is unsupported here.
    return undefined;
  }
  return value;
}

interface ListChatMemoryParams {
  source: ChatMemorySource;
  profileId?: string;
  chatSessionId?: string;
  memoryType?: MemoryType;
  query?: string;
  includeArchived: boolean;
  onlyUndistilled: boolean;
  limit: number;
  offset: number;
}

interface ChatMemorySegmentListItem {
  id: string;
  source: ChatMemorySource;
  profile_id: string;
  chat_session_id: string | null;
  memory_type: 'preference' | 'fact' | 'history';
  content: string;
  confidence_score: number | null;
  importance_score: number | null;
  distilled_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatMemorySegmentsPage {
  source: ChatMemorySource;
  items: ChatMemorySegmentListItem[];
  total: number;
  limit: number;
  offset: number;
}

interface ChatMemoryObservabilitySummary {
  counts: {
    jobs: {
      pending: number;
      running: number;
      completed: number;
      failed: number;
    };
    events: {
      promoted: number;
      updated: number;
    };
  };
  recent_failed_jobs: Array<{
    id: string;
    job_type: 'distill_session' | 'consolidate_profile';
    trigger_reason: string;
    attempts: number;
    max_attempts: number;
    last_error: string | null;
    updated_at: string;
  }>;
  recent_events: Array<{
    id: string;
    event_type: string;
    action: string;
    chat_session_id: string;
    profile_id: string | null;
    created_at: string;
  }>;
}

@Injectable()
export class ChatMemoryAdminService {
  constructor(
    private readonly sessionMemory: ChatSessionMemoryRepository,
    private readonly profileMemory: ChatProfileMemoryRepository,
    private readonly jobs: ChatMemoryJobRepository,
    private readonly events: ChatMemoryEventRepository,
  ) {}

  async listSegments(
    params: ListChatMemoryParams,
  ): Promise<ChatMemorySegmentsPage> {
    if (params.source === 'session') {
      const { items, total } = await this.sessionMemory.list({
        profileId: params.profileId,
        chatSessionId: params.chatSessionId,
        memoryType: toChatMemoryType(params.memoryType),
        query: params.query,
        onlyUndistilled: params.onlyUndistilled,
        limit: params.limit,
        offset: params.offset,
      });

      return {
        source: 'session',
        items: items.map((row) => ({
          id: row.id,
          source: 'session',
          profile_id: row.profile_id,
          chat_session_id: row.chat_session_id,
          memory_type: row.memory_type,
          content: row.content,
          confidence_score: null,
          importance_score: row.importance_score,
          distilled_at: toIso(row.distilled_at),
          archived_at: null,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        })),
        total,
        limit: params.limit,
        offset: params.offset,
      };
    }

    const { items, total } = await this.profileMemory.list({
      profileId: params.profileId,
      chatSessionId: params.chatSessionId,
      memoryType: toChatMemoryType(params.memoryType),
      query: params.query,
      includeArchived: params.includeArchived,
      limit: params.limit,
      offset: params.offset,
    });

    return {
      source: 'profile',
      items: items.map((row) => ({
        id: row.id,
        source: 'profile',
        profile_id: row.profile_id,
        chat_session_id: row.last_chat_session_id ?? null,
        memory_type: row.memory_type,
        content: row.content,
        confidence_score: row.confidence_score,
        importance_score: null,
        distilled_at: null,
        archived_at: toIso(row.archived_at),
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      })),
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }

  async getObservability(params?: {
    recentJobsLimit?: number;
    recentEventsLimit?: number;
  }): Promise<ChatMemoryObservabilitySummary> {
    const jobsLimit = sanitizeLimit(params?.recentJobsLimit, 20, 100);
    const eventsLimit = sanitizeLimit(params?.recentEventsLimit, 20, 100);

    const [
      pending,
      running,
      completed,
      failed,
      promoted,
      updated,
      recentJobs,
      recentEvents,
    ] = await Promise.all([
      this.jobs.countByStatus('pending'),
      this.jobs.countByStatus('running'),
      this.jobs.countByStatus('completed'),
      this.jobs.countByStatus('failed'),
      this.events.countByEventType('chat.memory.promoted.v1'),
      this.events.countByEventType('chat.memory.updated.v1'),
      this.jobs.listRecent(jobsLimit),
      this.events.listRecent(eventsLimit),
    ]);

    return {
      counts: {
        jobs: {
          pending,
          running,
          completed,
          failed,
        },
        events: {
          promoted,
          updated,
        },
      },
      recent_failed_jobs: recentJobs
        .filter((job) => job.status === 'failed')
        .map((job) => ({
          id: job.id,
          job_type: job.job_type,
          trigger_reason: job.trigger_reason,
          attempts: job.attempts,
          max_attempts: job.max_attempts,
          last_error: job.last_error ?? null,
          updated_at: job.updated_at.toISOString(),
        })),
      recent_events: recentEvents.map((event) => ({
        id: event.id,
        event_type: event.event_type,
        action: event.action,
        chat_session_id: event.chat_session_id,
        profile_id: event.profile_id ?? null,
        created_at: event.created_at.toISOString(),
      })),
    };
  }
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.toISOString();
}

function sanitizeLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return fallback;
  }

  return Math.min(value, max);
}

export type {
  ChatMemoryObservabilitySummary,
  ChatMemorySegmentListItem,
  ChatMemorySegmentsPage,
};
