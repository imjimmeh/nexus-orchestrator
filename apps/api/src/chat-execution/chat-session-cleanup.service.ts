import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import { ChatSession } from '../chat/database/entities/chat-session.entity';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * How long a session may remain in STARTING before it is treated as stuck.
 * The queue consumer moves sessions to RUNNING within seconds, and exhausted
 * retries terminate in FAILED, so anything still STARTING after this window
 * has a lost queue job and will never progress on its own.
 */
export const STARTING_STALE_GRACE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * NOTE: This service is session-centric and is intentionally kept separate from
 * the execution-centric ExecutionSupervisorService. It detects sessions that
 * never received an execution (orphaned) or never left STARTING (stuck-STARTING)
 * — structural gaps the supervisor cannot see because executions do not yet exist
 * for those sessions. Full deletion is deferred to Phase 5, when chat dispatch
 * becomes fire-and-poll and every session is guaranteed to carry an execution
 * from creation time.
 */

export const ORPHANED_SESSION_REASON =
  'Session never dispatched - no container or execution was ever created';

export const STUCK_STARTING_REASON =
  'Session stuck in STARTING with no execution dispatched (stale-session watchdog)';

@Injectable()
export class ChatSessionCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ChatSessionCleanupService.name);
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private readonly chatSessionRepo: ChatSessionRepository) {}

  onModuleInit(): void {
    // Sweep once at startup so sessions orphaned by a previous crash/restart
    // are reconciled immediately instead of lingering until the first interval.
    void this.runCleanup().catch((error: unknown) => {
      this.logger.error(
        `Startup chat session cleanup failed: ${(error as Error).message}`,
      );
    });

    this.intervalHandle = setInterval(() => {
      void this.runCleanup();
    }, CLEANUP_INTERVAL_MS);

    this.logger.log(
      `Orphaned chat session cleanup scheduled every ${CLEANUP_INTERVAL_MS.toString()}ms`,
    );
  }

  onModuleDestroy(): void {
    if (!this.intervalHandle) {
      return;
    }

    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  async runCleanup(): Promise<number> {
    if (this.isRunning) {
      return 0;
    }

    this.isRunning = true;
    try {
      const orphaned = await this.cleanupOrphanedSessions();
      const stuckStarting = await this.cleanupStuckStartingSessions();
      return orphaned + stuckStarting;
    } finally {
      this.isRunning = false;
    }
  }

  async cleanupOrphanedSessions(): Promise<number> {
    const orphaned = await this.chatSessionRepo.findOrphanedSessions();

    if (orphaned.length === 0) {
      this.logger.log('No orphaned sessions found');
      return 0;
    }

    this.logger.warn(
      `Found ${orphaned.length.toString()} orphaned chat sessions, cleaning up...`,
    );

    const cleaned = await this.failSessions(orphaned, ORPHANED_SESSION_REASON);

    this.logger.log(
      `Cleaned up ${cleaned.toString()}/${orphaned.length.toString()} orphaned sessions`,
    );
    return cleaned;
  }

  async cleanupStuckStartingSessions(): Promise<number> {
    const staleBefore = new Date(Date.now() - STARTING_STALE_GRACE_MS);
    const stuck =
      await this.chatSessionRepo.findStaleStartingSessions(staleBefore);

    if (stuck.length === 0) {
      return 0;
    }

    this.logger.warn(
      `Found ${stuck.length.toString()} chat sessions stuck in STARTING, cleaning up...`,
    );

    const cleaned = await this.failSessions(stuck, STUCK_STARTING_REASON);

    this.logger.log(
      `Cleaned up ${cleaned.toString()}/${stuck.length.toString()} stuck STARTING sessions`,
    );
    return cleaned;
  }

  private async failSessions(
    sessions: Pick<ChatSession, 'id'>[],
    reason: string,
  ): Promise<number> {
    let cleaned = 0;
    for (const session of sessions) {
      try {
        const wrote = await this.chatSessionRepo.failIfNotTerminal(session.id, {
          message: reason,
        });
        if (wrote) {
          cleaned++;
          this.logger.log(`Marked session ${session.id} as FAILED`);
        }
      } catch (error) {
        this.logger.error(
          `Failed to cleanup session ${session.id}: ${(error as Error).message}`,
        );
      }
    }
    return cleaned;
  }
}
