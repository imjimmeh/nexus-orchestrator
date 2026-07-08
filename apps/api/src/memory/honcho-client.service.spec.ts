import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { IMemorySegment } from '@nexus/core';
import { HonchoClientService } from './honcho-client.service';
import { HonchoTransportContractError } from './honcho-client.errors';
import type { HonchoRawSegment } from './honcho-client.types';
import type { MemoryType } from './memory-backend.types';

/**
 * Tests for work item 1291ad94-a07b-4fe6-91eb-456babcadb15 milestone 4 (M4):
 *
 *   - Task 4.1 exercises the six public static helpers added in M1/M2
 *     directly (no NestJS DI, no fetch mock) — round-trips, defaulting
 *     paths, alias ordering, version / date / id synthesis rules.
 *   - Task 4.2 wires a real `HonchoClientService` through
 *     `Test.createTestingModule(...)` with a stub `ConfigService` and
 *     `vi.spyOn(globalThis, 'fetch')` to confirm the four well-known
 *     envelope shapes (`results`, `messages`, `items`, `data`) each
 *     surface as `Promise<IMemorySegment[]>` with the synthesized id
 *     `${entityType}:${entityId}:${index}` when the upstream row
 *     carries no id.
 *
 * The tests deliberately mirror the implementation verbatim — the
 * alias order, the default policy, and the synthesized id format are
 * all contract surface, so any drift in the helper would surface as
 * a failed expectation here rather than silently in production.
 */

const ALL_MEMORY_TYPES: readonly MemoryType[] = [
  'preference',
  'fact',
  'history',
  'strategic_intent',
] as const;

interface RawSegmentOverrides {
  id?: string | undefined;
  content?: string | undefined;
  text?: string | undefined;
  message?: string | undefined;
  body?: string | undefined;
  version?: number | undefined;
  memory_type?: MemoryType | undefined;
  created_at?: string | Date | undefined;
  updated_at?: string | Date | undefined;
  metadata?: Record<string, unknown> | undefined;
}

function makeRawSegment(overrides: RawSegmentOverrides = {}): HonchoRawSegment {
  return {
    id: 'seg-1',
    content: 'hello',
    memory_type: 'fact',
    version: 5,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function buildConfigStub(): ConfigService {
  // Return `undefined` for every key so the service falls through to
  // its built-in defaults (`HONCHO_BASE_URL`, `HONCHO_LIST_PATH_TEMPLATE`,
  // `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY`, etc.). The integration tests
  // assert behaviour, not config wiring, so a stub-everything config
  // is the cleanest way to lock the defaults down.
  return {
    get: vi.fn(() => undefined),
  } as unknown as ConfigService;
}

function buildJsonResponse(envelope: unknown): Response {
  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HonchoClientService', () => {
  // -------------------------------------------------------------------------
  // Task 4.1.1 + 4.1.2 — `normalizeMemoryType`
  // -------------------------------------------------------------------------
  describe('normalizeMemoryType', () => {
    it('round-trips the "preference" MemoryType value', () => {
      expect(
        HonchoClientService.normalizeMemoryType(
          'preference',
          'log-then-history',
        ),
      ).toBe<MemoryType>('preference');
    });

    it('round-trips the "fact" MemoryType value', () => {
      expect(
        HonchoClientService.normalizeMemoryType('fact', 'log-then-history'),
      ).toBe<MemoryType>('fact');
    });

    it('round-trips the "history" MemoryType value', () => {
      expect(
        HonchoClientService.normalizeMemoryType('history', 'log-then-history'),
      ).toBe<MemoryType>('history');
    });

    it('round-trips the "strategic_intent" MemoryType value', () => {
      expect(
        HonchoClientService.normalizeMemoryType(
          'strategic_intent',
          'log-then-history',
        ),
      ).toBe<MemoryType>('strategic_intent');
    });

    it('accepts every closed-set MemoryType value under the default policy', () => {
      for (const value of ALL_MEMORY_TYPES) {
        expect(
          HonchoClientService.normalizeMemoryType(value, 'log-then-history'),
        ).toBe<MemoryType>(value);
      }
    });

    it('throws HonchoTransportContractError(field="memory_type") under "throw" policy', () => {
      let captured: unknown;
      try {
        HonchoClientService.normalizeMemoryType('mystery-value', 'throw');
      } catch (error) {
        captured = error;
      }
      expect(captured).toBeInstanceOf(HonchoTransportContractError);
      const typed = captured as HonchoTransportContractError;
      expect(typed.field).toBe('memory_type');
      expect(typed.name).toBe('HonchoTransportContractError');
    });

    it('throws on non-string values too when the policy is "throw"', () => {
      expect(() =>
        HonchoClientService.normalizeMemoryType(42, 'throw'),
      ).toThrow(HonchoTransportContractError);
      expect(() =>
        HonchoClientService.normalizeMemoryType(null, 'throw'),
      ).toThrow(HonchoTransportContractError);
    });

    it('silently coerces unknown values to "history" under "history" policy', () => {
      expect(
        HonchoClientService.normalizeMemoryType('mystery-value', 'history'),
      ).toBe<MemoryType>('history');
    });

    it('silently coerces unknown values to "history" under "log-then-history" policy', () => {
      expect(
        HonchoClientService.normalizeMemoryType(
          'mystery-value',
          'log-then-history',
        ),
      ).toBe<MemoryType>('history');
    });
  });

  // -------------------------------------------------------------------------
  // Task 4.1.3 — `extractCandidateMessages`
  // -------------------------------------------------------------------------
  describe('extractCandidateMessages', () => {
    it('returns the array verbatim for a top-level array input', () => {
      const arr = [
        makeRawSegment({ id: 'a' }),
        makeRawSegment({ id: 'b' }),
        makeRawSegment({ id: 'c' }),
      ];
      const result = HonchoClientService.extractCandidateMessages(arr);
      expect(result).toHaveLength(3);
      expect(result[0]?.id).toBe('a');
      expect(result[1]?.id).toBe('b');
      expect(result[2]?.id).toBe('c');
    });

    it('unwraps a { results: [...] } envelope', () => {
      const arr = [makeRawSegment({ id: 'a' }), makeRawSegment({ id: 'b' })];
      expect(
        HonchoClientService.extractCandidateMessages({ results: arr }),
      ).toHaveLength(2);
    });

    it('unwraps a { messages: [...] } envelope', () => {
      const arr = [makeRawSegment({ id: 'a' })];
      expect(
        HonchoClientService.extractCandidateMessages({ messages: arr }),
      ).toHaveLength(1);
    });

    it('unwraps an { items: [...] } envelope', () => {
      const arr = [makeRawSegment({ id: 'a' }), makeRawSegment({ id: 'b' })];
      expect(
        HonchoClientService.extractCandidateMessages({ items: arr }),
      ).toHaveLength(2);
    });

    it('unwraps a { data: [...] } envelope', () => {
      const arr = [makeRawSegment({ id: 'a' })];
      expect(
        HonchoClientService.extractCandidateMessages({ data: arr }),
      ).toHaveLength(1);
    });

    it('prefers "results" over later envelope keys when more than one is present', () => {
      const arr = [makeRawSegment({ id: 'a' })];
      expect(
        HonchoClientService.extractCandidateMessages({
          results: arr,
          messages: [makeRawSegment({ id: 'b' })],
          items: [makeRawSegment({ id: 'c' })],
          data: [makeRawSegment({ id: 'd' })],
        }),
      ).toHaveLength(1);
    });

    it('falls back through messages → items → data when earlier keys are absent', () => {
      const fromMessages = [makeRawSegment({ id: 'from-messages' })];
      const fromItems = [makeRawSegment({ id: 'from-items' })];
      const fromData = [makeRawSegment({ id: 'from-data' })];

      expect(
        HonchoClientService.extractCandidateMessages({
          messages: fromMessages,
        }),
      ).toHaveLength(1);
      expect(
        HonchoClientService.extractCandidateMessages({ items: fromItems }),
      ).toHaveLength(1);
      expect(
        HonchoClientService.extractCandidateMessages({ data: fromData }),
      ).toHaveLength(1);
    });

    it('returns an empty array for null input', () => {
      expect(HonchoClientService.extractCandidateMessages(null)).toEqual([]);
    });

    it('returns an empty array for undefined input', () => {
      expect(HonchoClientService.extractCandidateMessages(undefined)).toEqual(
        [],
      );
    });

    it('returns an empty array for non-object primitives', () => {
      expect(HonchoClientService.extractCandidateMessages('hello')).toEqual([]);
      expect(HonchoClientService.extractCandidateMessages(42)).toEqual([]);
      expect(HonchoClientService.extractCandidateMessages(true)).toEqual([]);
    });

    it('returns an empty array when envelope keys are present but not arrays', () => {
      expect(
        HonchoClientService.extractCandidateMessages({
          results: 'not an array',
          messages: 42,
        }),
      ).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Task 4.1.4 — `readContent`
  // -------------------------------------------------------------------------
  describe('readContent', () => {
    it('returns the value of "content" when it is a non-empty string', () => {
      expect(
        HonchoClientService.readContent(
          makeRawSegment({ content: 'via content' }),
        ),
      ).toBe('via content');
    });

    it('falls back to "text" when "content" is missing', () => {
      expect(HonchoClientService.readContent({ text: 'via text' })).toBe(
        'via text',
      );
    });

    it('falls back to "message" when "content" and "text" are both missing', () => {
      expect(HonchoClientService.readContent({ message: 'via message' })).toBe(
        'via message',
      );
    });

    it('falls back to "body" when content/text/message are all missing', () => {
      expect(HonchoClientService.readContent({ body: 'via body' })).toBe(
        'via body',
      );
    });

    it('returns the second alias when the first alias is empty/whitespace', () => {
      const candidate = makeRawSegment({
        content: '   ',
        text: 'real content',
      });
      expect(HonchoClientService.readContent(candidate)).toBe('real content');
    });

    it('skips over every empty / whitespace alias in priority order', () => {
      const candidate = makeRawSegment({
        content: '',
        text: '\t',
        message: '   \n',
        body: 'winning body',
      });
      expect(HonchoClientService.readContent(candidate)).toBe('winning body');
    });

    it('trims whitespace from the resolved content', () => {
      expect(
        HonchoClientService.readContent({ content: '  hello world  ' }),
      ).toBe('hello world');
    });

    it('returns null when all four aliases are missing', () => {
      expect(HonchoClientService.readContent({ id: 'x' })).toBeNull();
    });

    it('returns null when all four aliases are empty / whitespace', () => {
      expect(
        HonchoClientService.readContent({
          content: '',
          text: '   ',
          message: '',
          body: '\t\n',
        }),
      ).toBeNull();
    });

    it('returns null when aliases are non-string values', () => {
      expect(
        HonchoClientService.readContent({
          content: 42,
          text: null,
          message: { nested: true },
          body: ['x'],
        }),
      ).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Task 4.1.5 — `parseDate`
  // -------------------------------------------------------------------------
  describe('parseDate', () => {
    it('parses an ISO 8601 string into a Date instance', () => {
      const result = HonchoClientService.parseDate('2024-01-01T00:00:00.000Z');
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('returns the same Date instance when given a Date input (identity preserved)', () => {
      const input = new Date('2024-05-15T12:34:56.000Z');
      const result = HonchoClientService.parseDate(input);
      expect(result).toBe(input);
    });

    it('returns the epoch sentinel (new Date(0)) for unparseable strings', () => {
      const result = HonchoClientService.parseDate('not a date');
      expect(result).toBeInstanceOf(Date);
      expect(Number.isNaN(result.getTime())).toBe(false);
      expect(result.getTime()).toBe(0);
    });

    it('returns the epoch sentinel for null', () => {
      const result = HonchoClientService.parseDate(null);
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(0);
    });

    it('returns the epoch sentinel for undefined', () => {
      const result = HonchoClientService.parseDate(undefined);
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(0);
    });

    it('returns the epoch sentinel for non-string / non-Date primitives', () => {
      expect(HonchoClientService.parseDate(42).getTime()).toBe(0);
      expect(HonchoClientService.parseDate(true).getTime()).toBe(0);
      expect(HonchoClientService.parseDate({}).getTime()).toBe(0);
      expect(HonchoClientService.parseDate([]).getTime()).toBe(0);
    });

    it('preserves milliseconds precision when parsing a precise ISO timestamp', () => {
      const result = HonchoClientService.parseDate('2024-06-15T08:30:45.123Z');
      expect(result.toISOString()).toBe('2024-06-15T08:30:45.123Z');
    });
  });

  // -------------------------------------------------------------------------
  // Task 4.1.6 — `mapCandidate`
  // -------------------------------------------------------------------------
  describe('mapCandidate', () => {
    const baseParams = { entityType: 'User', entityId: 'u1' };

    it('synthesizes id as `${entityType}:${entityId}:${index}` when no upstream id is present', () => {
      const candidate = makeRawSegment({ id: undefined });
      const segment = HonchoClientService.mapCandidate(
        candidate,
        baseParams,
        0,
        'log-then-history',
      );
      expect(segment).not.toBeNull();
      expect(segment?.id).toBe('User:u1:0');
    });

    it('uses the candidate id verbatim when one is present', () => {
      const candidate = makeRawSegment({ id: 'upstream-id-42' });
      const segment = HonchoClientService.mapCandidate(
        candidate,
        baseParams,
        0,
        'log-then-history',
      );
      expect(segment?.id).toBe('upstream-id-42');
    });

    it('falls back to the synthesized id when the candidate id is empty/whitespace', () => {
      const candidate = makeRawSegment({ id: '   ' });
      const segment = HonchoClientService.mapCandidate(
        candidate,
        baseParams,
        7,
        'log-then-history',
      );
      expect(segment?.id).toBe('User:u1:7');
    });

    it('uses the row index in the synthesized id', () => {
      const segment = HonchoClientService.mapCandidate(
        makeRawSegment({ id: undefined }),
        { entityType: 'Project', entityId: 'proj-99' },
        12,
        'log-then-history',
      );
      expect(segment?.id).toBe('Project:proj-99:12');
    });

    it('coerces version <= 0 to 1 (zero)', () => {
      const segment = HonchoClientService.mapCandidate(
        makeRawSegment({ version: 0 }),
        baseParams,
        0,
        'log-then-history',
      );
      expect(segment?.version).toBe(1);
    });

    it('coerces version <= 0 to 1 (negative)', () => {
      const segment = HonchoClientService.mapCandidate(
        makeRawSegment({ version: -5 }),
        baseParams,
        0,
        'log-then-history',
      );
      expect(segment?.version).toBe(1);
    });

    it('coerces missing version to 1', () => {
      const segment = HonchoClientService.mapCandidate(
        makeRawSegment({ version: undefined }),
        baseParams,
        0,
        'log-then-history',
      );
      expect(segment?.version).toBe(1);
    });

    it('preserves version > 0 verbatim', () => {
      const segment = HonchoClientService.mapCandidate(
        makeRawSegment({ version: 7 }),
        baseParams,
        0,
        'log-then-history',
      );
      expect(segment?.version).toBe(7);
    });

    it('maps every field for a fully-populated candidate', () => {
      const candidate = makeRawSegment({
        id: 'seg-1',
        content: 'hello',
        memory_type: 'preference',
        version: 5,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-06-15T00:00:00.000Z',
      });
      const segment = HonchoClientService.mapCandidate(
        candidate,
        baseParams,
        0,
        'log-then-history',
      );
      expect(segment).toEqual<IMemorySegment>({
        id: 'seg-1',
        entity_type: 'User',
        entity_id: 'u1',
        memory_type: 'preference',
        content: 'hello',
        version: 5,
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        updated_at: new Date('2024-06-15T00:00:00.000Z'),
      });
    });

    it('returns null when content is missing from every alias', () => {
      const segment = HonchoClientService.mapCandidate(
        { id: 'x', version: 1, memory_type: 'fact' },
        baseParams,
        0,
        'log-then-history',
      );
      expect(segment).toBeNull();
    });

    it('reads memory_type from metadata.memory_type when memory_type is absent', () => {
      const candidate = makeRawSegment({
        memory_type: undefined,
        metadata: { memory_type: 'history' },
      });
      const segment = HonchoClientService.mapCandidate(
        candidate,
        baseParams,
        0,
        'log-then-history',
      );
      expect(segment?.memory_type).toBe<MemoryType>('history');
    });

    it('prefers metadata.memory_type over top-level memory_type when both are set', () => {
      // The implementation reads `candidate.metadata?.memory_type ??
      // candidate.memory_type`. With nullish coalescing the
      // metadata-side wins when both are populated — this test
      // pins that precedence so a future refactor cannot silently
      // flip it without breaking a contract.
      const candidate = makeRawSegment({
        memory_type: 'fact',
        metadata: { memory_type: 'history' },
      });
      const segment = HonchoClientService.mapCandidate(
        candidate,
        baseParams,
        0,
        'log-then-history',
      );
      expect(segment?.memory_type).toBe<MemoryType>('history');
    });

    it('surfaces HonchoTransportContractError when "throw" policy sees an unknown memory_type', () => {
      const candidate = makeRawSegment({
        memory_type: 'mystery-value' as unknown as MemoryType,
      });
      expect(() =>
        HonchoClientService.mapCandidate(candidate, baseParams, 0, 'throw'),
      ).toThrow(HonchoTransportContractError);
    });

    it('copies entity_type / entity_id verbatim from the normalization context', () => {
      const segment = HonchoClientService.mapCandidate(
        makeRawSegment(),
        { entityType: 'Project', entityId: 'p-42' },
        0,
        'log-then-history',
      );
      expect(segment?.entity_type).toBe('Project');
      expect(segment?.entity_id).toBe('p-42');
    });
  });

  // -------------------------------------------------------------------------
  // Bonus: `normalizeHonchoResponse` orchestration (4.1 sub-case f glue)
  //
  // The Task 4.1 brief calls out the six helpers as separate groups,
  // but the orchestrator that ties them together is itself a public
  // static and is worth pinning so a regression in the
  // extract → map → filter pipeline cannot slip through unnoticed.
  // -------------------------------------------------------------------------
  describe('normalizeHonchoResponse (orchestrator)', () => {
    const ctx = {
      entityType: 'User',
      entityId: 'u1',
      unknownMemoryTypePolicy: 'log-then-history' as const,
    };

    it('returns an empty array when the response has no recognised envelope', () => {
      expect(HonchoClientService.normalizeHonchoResponse(null, ctx)).toEqual(
        [],
      );
      expect(
        HonchoClientService.normalizeHonchoResponse(
          { unknown_key: ['x'] },
          ctx,
        ),
      ).toEqual([]);
    });

    it('returns an empty array when every candidate fails the content guard', () => {
      const result = HonchoClientService.normalizeHonchoResponse(
        [{ id: 'a', content: '' }, { id: 'b' }],
        ctx,
      );
      expect(result).toEqual([]);
    });

    it('synthesizes ids from the context when the raw rows carry no id', () => {
      const result = HonchoClientService.normalizeHonchoResponse(
        [
          { content: 'first', memory_type: 'fact' },
          { content: 'second', memory_type: 'history' },
        ],
        ctx,
      );
      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('User:u1:0');
      expect(result[1]?.id).toBe('User:u1:1');
    });

    it('silently coerces unknown memory_type values to "history" under the default policy', () => {
      const result = HonchoClientService.normalizeHonchoResponse(
        [{ content: 'mystery row', memory_type: 'who-knows' }],
        ctx,
      );
      expect(result[0]?.memory_type).toBe<MemoryType>('history');
    });
  });

  // -------------------------------------------------------------------------
  // Task 4.2 — typed-return integration tests with mocked fetch
  // -------------------------------------------------------------------------
  describe('listPeerMemory (typed-return integration with mocked fetch)', () => {
    let moduleRef: TestingModule;
    let client: HonchoClientService;
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      moduleRef = await Test.createTestingModule({
        providers: [
          HonchoClientService,
          { provide: ConfigService, useValue: buildConfigStub() },
        ],
      }).compile();
      client = moduleRef.get(HonchoClientService);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await moduleRef.close();
    });

    function stubFetchOk(envelope: unknown): void {
      fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(buildJsonResponse(envelope));
    }

    it('unwraps a { results: [...] } envelope into IMemorySegment[] with synthesized id', async () => {
      stubFetchOk({
        results: [{ content: 'hello', memory_type: 'fact', version: 2 }],
      });

      const segments = await client.listPeerMemory({
        workspaceId: 'w1',
        peerId: 'p1',
        entityType: 'User',
        entityId: 'u1',
      });

      expect(Array.isArray(segments)).toBe(true);
      expect(segments).toHaveLength(1);
      expect(segments[0]?.memory_type).toBe<MemoryType>('fact');
      expect(segments[0]?.content).toBe('hello');
      expect(segments[0]?.version).toBe(2);
      expect(segments[0]?.id).toBe('User:u1:0');
      expect(segments[0]?.entity_type).toBe('User');
      expect(segments[0]?.entity_id).toBe('u1');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('unwraps a { messages: [...] } envelope into IMemorySegment[]', async () => {
      stubFetchOk({
        messages: [
          { content: 'via messages', memory_type: 'preference', version: 3 },
        ],
      });

      const segments = await client.listPeerMemory({
        workspaceId: 'w1',
        peerId: 'p1',
        entityType: 'User',
        entityId: 'u1',
      });

      expect(segments).toHaveLength(1);
      expect(segments[0]?.memory_type).toBe<MemoryType>('preference');
      expect(segments[0]?.content).toBe('via messages');
      expect(segments[0]?.version).toBe(3);
      expect(segments[0]?.id).toBe('User:u1:0');
    });

    it('unwraps an { items: [...] } envelope into IMemorySegment[]', async () => {
      stubFetchOk({
        items: [{ content: 'via items', memory_type: 'history', version: 4 }],
      });

      const segments = await client.listPeerMemory({
        workspaceId: 'w1',
        peerId: 'p1',
        entityType: 'User',
        entityId: 'u1',
      });

      expect(segments).toHaveLength(1);
      expect(segments[0]?.memory_type).toBe<MemoryType>('history');
      expect(segments[0]?.content).toBe('via items');
      expect(segments[0]?.version).toBe(4);
      expect(segments[0]?.id).toBe('User:u1:0');
    });

    it('unwraps a { data: [...] } envelope into IMemorySegment[]', async () => {
      stubFetchOk({
        data: [
          {
            content: 'via data',
            memory_type: 'strategic_intent',
            version: 9,
          },
        ],
      });

      const segments = await client.listPeerMemory({
        workspaceId: 'w1',
        peerId: 'p1',
        entityType: 'User',
        entityId: 'u1',
      });

      expect(segments).toHaveLength(1);
      expect(segments[0]?.memory_type).toBe<MemoryType>('strategic_intent');
      expect(segments[0]?.content).toBe('via data');
      expect(segments[0]?.version).toBe(9);
      expect(segments[0]?.id).toBe('User:u1:0');
    });
  });
});
