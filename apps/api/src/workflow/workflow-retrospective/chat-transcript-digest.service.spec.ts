import { Test, TestingModule } from '@nestjs/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChatTranscriptDigestService } from './chat-transcript-digest.service';
import { CHAT_SESSION_MEMORY_PORT } from '../domain-ports';
import { TokenCounterService } from '../../memory/token-counter.service';
import { RuntimeFeedbackRedactionService } from '../../runtime-feedback/runtime-feedback-redaction.service';
import { SystemSettingsService } from '../../settings/system-settings.service';

describe('ChatTranscriptDigestService', () => {
  let service: ChatTranscriptDigestService;
  let sessionMemory: any;
  let tokenCounter: any;
  let redaction: any;
  let settings: any;

  beforeEach(async () => {
    sessionMemory = {
      findRecentBySession: vi.fn(),
    };
    tokenCounter = {
      countTokens: vi.fn(),
    };
    redaction = {
      sanitizeSummary: vi.fn((val) => val),
    };
    settings = {
      get: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatTranscriptDigestService,
        { provide: CHAT_SESSION_MEMORY_PORT, useValue: sessionMemory },
        { provide: TokenCounterService, useValue: tokenCounter },
        { provide: RuntimeFeedbackRedactionService, useValue: redaction },
        { provide: SystemSettingsService, useValue: settings },
      ],
    }).compile();

    service = module.get<ChatTranscriptDigestService>(
      ChatTranscriptDigestService,
    );
  });

  it('builds a clean transcript digest', async () => {
    sessionMemory.findRecentBySession.mockResolvedValue([
      {
        id: '1',
        source_role: 'user',
        content: 'hello',
        created_at: new Date(1000),
      },
      {
        id: '2',
        source_role: 'assistant',
        content: 'hi',
        created_at: new Date(2000),
      },
    ]);
    tokenCounter.countTokens.mockReturnValue(10);
    settings.get.mockResolvedValue(4000);

    const digest = await service.buildDigest('session-123', 'scope-456');

    expect(digest.runId).toBe('session-123');
    expect(digest.scopeId).toBe('scope-456');
    expect(digest.toolTimeline).toHaveLength(2);
    expect(digest.toolTimeline[0].summary).toBe('[USER]: hello');
    expect(digest.evidenceEventIds).toEqual(['chat_msg:1', 'chat_msg:2']);
    expect(digest.truncated).toBe(false);
  });

  it('truncates digest if it exceeds token budget', async () => {
    sessionMemory.findRecentBySession.mockResolvedValue([
      {
        id: '1',
        source_role: 'user',
        content: 'message 1',
        created_at: new Date(1000),
      },
      {
        id: '2',
        source_role: 'assistant',
        content: 'message 2',
        created_at: new Date(2000),
      },
    ]);
    settings.get.mockResolvedValue(5); // small budget
    tokenCounter.countTokens
      .mockReturnValueOnce(10) // 2 messages = 10 tokens (> budget)
      .mockReturnValueOnce(3); // 1 message = 3 tokens (<= budget)

    const digest = await service.buildDigest('session-123', 'scope-456');

    expect(digest.toolTimeline).toHaveLength(1);
    expect(digest.toolTimeline[0].summary).toBe('[ASSISTANT]: message 2');
    expect(digest.truncated).toBe(true);
  });
});
