import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CHAT_SESSION_MEMORY_PORT,
  type IChatSessionMemoryPort,
} from '../domain-ports';
import { TokenCounterService } from '../../memory/token-counter.service';
import { RuntimeFeedbackRedactionService } from '../../runtime-feedback/runtime-feedback-redaction.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import type {
  RunDigest,
  DigestTimelineEntry,
} from './run-transcript-digest.types';
import {
  RUN_TRANSCRIPT_DIGEST_SETTING_DEFAULTS,
  RUN_TRANSCRIPT_DIGEST_SETTING_KEYS,
} from './run-transcript-digest.settings.constants';

const DIGEST_TOKEN_MODEL = 'gpt-4';
const MAX_SUMMARY_CHARS = 1024;

@Injectable()
export class ChatTranscriptDigestService {
  private readonly logger = new Logger(ChatTranscriptDigestService.name);

  constructor(
    @Inject(CHAT_SESSION_MEMORY_PORT)
    private readonly sessionMemory: IChatSessionMemoryPort,
    private readonly tokenCounter: TokenCounterService,
    private readonly redaction: RuntimeFeedbackRedactionService,
    private readonly settings: SystemSettingsService,
  ) {}

  async buildDigest(
    sessionId: string,
    scopeId: string | null = null,
  ): Promise<RunDigest> {
    try {
      const rawMessages = await this.sessionMemory.findRecentBySession(
        sessionId,
        100,
      );
      const chronological = [...rawMessages].sort(
        (left, right) => left.created_at.getTime() - right.created_at.getTime(),
      );

      const maxTokens = await this.resolveMaxTokens();

      const timeline: DigestTimelineEntry[] = [];

      for (const m of chronological) {
        const eventId = `chat_msg:${m.id}`;

        const cleaned = m.content.split('\0').join('');
        const redacted = this.redaction.sanitizeSummary(cleaned);
        const role = m.source_role.toUpperCase();
        const summary = `[${role}]: ${redacted}`.substring(
          0,
          MAX_SUMMARY_CHARS,
        );

        timeline.push({
          eventId,
          tool: 'chat_message',
          outcome: 'success',
          summary,
        });
      }

      const kept = [...timeline];
      let truncated = false;

      while (kept.length > 0) {
        const serialized = this.serializeForCount(sessionId, scopeId, kept);
        const tokens = this.tokenCounter.countTokens(
          serialized,
          DIGEST_TOKEN_MODEL,
        );
        if (tokens <= maxTokens) {
          break;
        }
        kept.shift();
        truncated = true;
      }

      return {
        runId: sessionId,
        scopeId,
        struggleSpans: [],
        toolTimeline: kept,
        errorClusters: [],
        evidenceEventIds: kept.map((entry) => entry.eventId),
        truncated,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `ChatTranscriptDigestService failed to build digest for session ${sessionId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        runId: sessionId,
        scopeId,
        struggleSpans: [],
        toolTimeline: [],
        errorClusters: [],
        evidenceEventIds: [],
        truncated: true,
      };
    }
  }

  private serializeForCount(
    sessionId: string,
    scopeId: string | null,
    timeline: DigestTimelineEntry[],
  ): string {
    const lines = [
      `chat_session_id: ${sessionId}`,
      `scope_id: ${scopeId ?? 'none'}`,
      '--- Chat History ---',
      ...timeline.map((entry) => entry.summary),
    ];
    return lines.join('\n');
  }

  private async resolveMaxTokens(): Promise<number> {
    try {
      const value = await this.settings.get<unknown>(
        RUN_TRANSCRIPT_DIGEST_SETTING_KEYS.maxTokens,
        RUN_TRANSCRIPT_DIGEST_SETTING_DEFAULTS.maxTokens,
      );
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
      }
      return RUN_TRANSCRIPT_DIGEST_SETTING_DEFAULTS.maxTokens;
    } catch {
      return RUN_TRANSCRIPT_DIGEST_SETTING_DEFAULTS.maxTokens;
    }
  }
}
