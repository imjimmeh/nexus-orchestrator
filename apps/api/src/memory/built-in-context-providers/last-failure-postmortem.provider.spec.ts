import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LastFailurePostmortemProvider } from './last-failure-postmortem.provider';
import { ChatSession } from '../../chat/database/entities/chat-session.entity';
import type { WorkflowEventRepository } from '../../workflow/database/repositories/workflow-event.repository';
import type { WorkflowEvent } from '../../workflow/database/entities/workflow-event.entity';

/**
 * Vitest unit tests for `LastFailurePostmortemProvider`.
 *
 * The provider depends only on `WorkflowEventRepository` (registered
 * globally by `DatabaseModule`, which `BuiltInMemoryContextProvidersModule`
 * already imports — see M5 wiring notes on the provider itself). The
 * tests instantiate the provider directly with a `vi.fn()` mock,
 * matching the pattern used in
 * `workflow-trigger-registry.service.spec.ts` and the other
 * built-in-context-provider specs in this directory.
 *
 * Coverage:
 *   (a) `canProvide` returns false when the mocked repository reports
 *       zero failure events.
 *   (b) `canProvide` returns true when the mocked repository reports at
 *       least one failure event for the scope.
 *   (c) `getContext` renders the latest failure's timestamp,
 *       `event_type`, and payload excerpt in the markdown block.
 *   (d) `cacheTtlSeconds` is `null` (asserted as a constant on the
 *       provider instance — same pattern as the module-level contract
 *       test in `built-in-memory-context-providers.module.spec.ts`).
 */
describe('LastFailurePostmortemProvider', () => {
  const findPaged = vi.fn();

  let provider: LastFailurePostmortemProvider;

  function buildSession(overrides: Partial<ChatSession> = {}): ChatSession {
    return {
      id: 'sess-1',
      agent_profile_id: 'ap-1',
      agent_profile_name: 'agent-1',
      initial_message: 'hi',
      status: 'RUNNING' as ChatSession['status'],
      container_tier: 2,
      source: 'ad_hoc' as ChatSession['source'],
      session_type: 'general' as ChatSession['session_type'],
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    } as ChatSession;
  }

  function buildFailureEvent(
    overrides: Partial<WorkflowEvent> = {},
  ): WorkflowEvent {
    return {
      id: 'evt-1',
      workflow_run_id: 'run-1',
      event_type: 'workflow.failed',
      payload: { reason: 'Tool contract mismatch' },
      timestamp: new Date('2026-06-12T18:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LastFailurePostmortemProvider({
      findPaged,
    } as unknown as WorkflowEventRepository);
  });

  it('returns false from canProvide when the repository reports zero failure events', async () => {
    const session = buildSession({ scopeId: 'scope-1' });
    findPaged.mockResolvedValue([[], 0]);

    const result = await provider.canProvide(session);

    expect(result).toBe(false);
    expect(findPaged).toHaveBeenCalledTimes(1);
    expect(findPaged).toHaveBeenCalledWith(
      { limit: LastFailurePostmortemProvider.LOOKUP_LIMIT, offset: 0 },
      {
        scopeId: 'scope-1',
        eventTypes: LastFailurePostmortemProvider.FAILURE_EVENT_TYPES,
      },
    );
  });

  it('returns false from canProvide when scopeId is null without calling the repository', async () => {
    const session = buildSession({ scopeId: null });

    const result = await provider.canProvide(session);

    expect(result).toBe(false);
    expect(findPaged).not.toHaveBeenCalled();
  });

  it('returns true from canProvide when the repository reports at least one failure event', async () => {
    const session = buildSession({ scopeId: 'scope-1' });
    findPaged.mockResolvedValue([[buildFailureEvent()], 1]);

    const result = await provider.canProvide(session);

    expect(result).toBe(true);
    expect(findPaged).toHaveBeenCalledTimes(1);
    expect(findPaged).toHaveBeenCalledWith(
      { limit: LastFailurePostmortemProvider.LOOKUP_LIMIT, offset: 0 },
      {
        scopeId: 'scope-1',
        eventTypes: LastFailurePostmortemProvider.FAILURE_EVENT_TYPES,
      },
    );
  });

  it('renders a markdown block containing the latest failure timestamp, event_type, and payload excerpt', async () => {
    const session = buildSession({ scopeId: 'scope-1' });
    const latestFailure = buildFailureEvent({
      id: 'evt-latest',
      workflow_run_id: 'run-7',
      event_type: 'job.failed',
      payload: {
        reason: 'Tool contract mismatch on github.create_pr',
        jobId: 'job-42',
      },
      timestamp: new Date('2026-06-12T18:30:45.000Z'),
    });
    findPaged.mockResolvedValue([[latestFailure], 1]);

    const block = await provider.getContext(session);

    expect(block.title).toBe('Last Failure Postmortem');
    expect(block.priority).toBe(170);
    expect(block.content).toContain('## Last Failure Postmortem');
    expect(block.content).toContain(
      '- **Occurred at**: 2026-06-12T18:30:45.000Z',
    );
    expect(block.content).toContain('- **Event type**: job.failed');
    expect(block.content).toContain('- **Workflow run**: run-7');
    // The payload excerpt is JSON-serialized, so we assert on a
    // substring of the rendered value rather than the exact shape.
    expect(block.content).toContain('Tool contract mismatch');
    expect(block.content).toContain('github.create_pr');

    expect(block.metadata).toEqual(
      expect.objectContaining({
        source: 'last-failure-postmortem',
        provider: 'last-failure-postmortem',
        cacheTtlSeconds: null,
        scopeId: 'scope-1',
        eventType: 'job.failed',
        workflowRunId: 'run-7',
        occurredAt: '2026-06-12T18:30:45.000Z',
      }),
    );
  });

  it('returns the well-formed empty block from getContext when no failure events exist for the scope', async () => {
    const session = buildSession({ scopeId: 'scope-1' });
    findPaged.mockResolvedValue([[], 0]);

    const block = await provider.getContext(session);

    expect(block.title).toBe('Last Failure Postmortem');
    expect(block.priority).toBe(170);
    expect(block.content).toContain('## Last Failure Postmortem');
    expect(block.metadata).toEqual(
      expect.objectContaining({
        source: 'last-failure-postmortem',
        provider: 'last-failure-postmortem',
        cacheTtlSeconds: null,
        failureEventCount: 0,
      }),
    );
  });

  it('exposes cacheTtlSeconds=null on the provider instance (always fresh contract)', () => {
    expect(provider.cacheTtlSeconds).toBeNull();
  });
});
