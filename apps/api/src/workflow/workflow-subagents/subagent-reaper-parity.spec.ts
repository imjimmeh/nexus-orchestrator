import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Docker from 'dockerode';
import type { DomainEventEnvelope } from '../../domain-events/domain-event-bus.types';
import type { InProcessDomainEventBus } from '../../domain-events/in-process-domain-event.bus';
import type { IChatSessionRepositoryPort } from '../domain-ports';
import { ChatSessionTerminalRouter } from '../../chat-execution/chat-session-terminal.router';
import { ExecutionSupervisorService } from '../../execution-lifecycle/execution-supervisor.service';
import { ServiceLifecycleStateService } from '../../execution-lifecycle/service-lifecycle-state.service';
import { ShutdownStateService } from '../../shutdown/shutdown-state.service';
import type { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import type { ExecutionEntity } from '../../execution-lifecycle/database/entities/execution.entity';
import {
  DEFAULT_PROVISION_GRACE_MS,
  DEFAULT_CONTAINER_LOST_GRACE_MS,
} from '../../execution-lifecycle/execution-supervision.helpers';
import { EXECUTION_EVENT_TYPES } from '../../execution-lifecycle/execution-lifecycle.contracts';
import type { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import type { MeshDelegationService } from './mesh-delegation.service';
import { SubagentReapedListener } from './subagent-reaped.listener';

/**
 * Parity matrix for the unified subagent reaping pipeline.
 *
 * This suite is the safety gate that proves the new architecture
 *   ExecutionSupervisorService.sweepOnce()  (classify → emit execution.reaped)
 *     → SubagentReapedListener                (subagent_executions Failed + diagnostics + mesh-cancel)
 *     → ChatSessionTerminalRouter             (linked chat_session → FAILED)
 * reproduces every OBSERVABLE outcome of the legacy
 * `SubagentExecutionReaperService` for the two reasons the new supervisor owns:
 *   - spawn_timeout   (provisioning execution stuck past the grace window)
 *   - container_lost  (container continuously lost past the debounce window)
 *
 * The legacy reaper's third reason, `chat_session_failed` (a reverse
 * session→execution signal), is intentionally NOT exercised here: the new
 * supervisor has no equivalent classifier. That gap is documented in the
 * task's Part B investigation, not asserted as parity.
 *
 * We test the SEAMS rather than full DI wiring: the real supervisor classifier
 * decides the reason and emits the canonical `execution.reaped` envelope; the
 * real listeners consume an equivalent envelope and perform the legacy
 * side-effects. Reasons travel as the same string literals the legacy reaper
 * used (`spawn_timeout`, `container_lost`), so failure_reason parity is exact.
 */

const SUBAGENT_ID = 'sub-exec-1';
const CHILD_CONTAINER_ID = 'child-container-1';
const CHAT_SESSION_ID = 'chat-session-1';

// ---------------------------------------------------------------------------
// Supervisor harness — drives the real classifier to emit execution.reaped.
// ---------------------------------------------------------------------------

interface CapturedReap {
  executionId: string;
  failure_reason: string;
  error_message?: string | null;
}

function buildSupervisor(
  nonTerminalRows: Array<Record<string, unknown>>,
  isContainerLost: boolean,
): { service: ExecutionSupervisorService; captured: CapturedReap[] } {
  const captured: CapturedReap[] = [];
  const repo = {
    findNonTerminal: vi.fn().mockResolvedValue(nonTerminalRows),
  };
  const publisher = {
    reaped: vi
      .fn()
      .mockImplementation(
        async (executionId: string, payload: CapturedReap) => {
          captured.push({ executionId, ...payload });
        },
      ),
  };
  const docker = {
    isContainerLost: vi.fn().mockResolvedValue(isContainerLost),
  };
  const lifecycle = new ServiceLifecycleStateService();
  lifecycle.markRunning();
  const shutdownState = new ShutdownStateService();
  vi.spyOn(shutdownState, 'isShuttingDown').mockReturnValue(false);
  const service = new ExecutionSupervisorService(
    repo as never,
    publisher as never,
    docker,
    lifecycle,
    shutdownState,
  );
  return { service, captured };
}

// ---------------------------------------------------------------------------
// Listener harness — consumes execution.reaped and reproduces side-effects.
// ---------------------------------------------------------------------------

function buildReapedEnvelope(
  failureReason: string,
  errorMessage: string,
): DomainEventEnvelope {
  return {
    eventId: 'event-parity',
    eventType: EXECUTION_EVENT_TYPES.reaped,
    aggregateId: SUBAGENT_ID,
    aggregateType: 'execution',
    payload: { failure_reason: failureReason, error_message: errorMessage },
    occurredAt: new Date(),
  };
}

function buildExecutionRow(
  containerId: string | null = CHILD_CONTAINER_ID,
): ExecutionEntity {
  return {
    id: SUBAGENT_ID,
    kind: 'subagent',
    state: 'reaped',
    container_id: containerId,
    chat_session_id: CHAT_SESSION_ID,
  } as unknown as ExecutionEntity;
}

interface ListenerHarness {
  reapedListener: SubagentReapedListener;
  cascadeListener: ChatSessionTerminalRouter;
  subagentDetailsUpsert: ReturnType<typeof vi.fn>;
  handleSubagentCancellation: ReturnType<typeof vi.fn>;
  chatSessionFailIfNotTerminal: ReturnType<typeof vi.fn>;
}

function buildListeners(
  childContainerId: string | null,
  containerLogs: string,
): ListenerHarness {
  const subagentDetailsUpsert = vi.fn().mockResolvedValue(undefined);
  const handleSubagentCancellation = vi.fn().mockResolvedValue(null);
  const chatSessionFailIfNotTerminal = vi.fn().mockResolvedValue(true);

  const executionFindById = vi
    .fn()
    .mockResolvedValue(buildExecutionRow(childContainerId));

  const logsMock = vi.fn().mockResolvedValue(Buffer.from(containerLogs));
  const docker = {
    getContainer: vi.fn(() => ({ logs: logsMock })),
  } as unknown as Docker;

  const noopBus = { on: vi.fn() } as unknown as InProcessDomainEventBus;

  const reapedListener = new SubagentReapedListener(
    noopBus,
    { findById: executionFindById } as unknown as ExecutionRepository,
    {
      upsert: subagentDetailsUpsert,
    } as unknown as SubagentDetailsRepository,
    {
      handleSubagentCancellation,
    } as unknown as MeshDelegationService,
    docker,
    { removeContainer: vi.fn().mockResolvedValue(undefined) } as never,
  );

  const cascadeListener = new ChatSessionTerminalRouter(
    noopBus,
    {
      findById: vi.fn().mockResolvedValue({
        id: SUBAGENT_ID,
        kind: 'subagent',
        chat_session_id: CHAT_SESSION_ID,
        failure_reason: 'container_lost',
        error_message: 'Execution container exited or was lost',
      }),
    } as unknown as ExecutionRepository,
    {
      failIfNotTerminal: chatSessionFailIfNotTerminal,
    } as unknown as IChatSessionRepositoryPort,
    { saveSessionForChat: vi.fn() } as never,
    { emit: vi.fn() },
  );

  return {
    reapedListener,
    cascadeListener,
    subagentDetailsUpsert,
    handleSubagentCancellation,
    chatSessionFailIfNotTerminal,
  };
}

describe('reaper parity: unified subagent reaping vs legacy SubagentExecutionReaperService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Logger.overrideLogger(false);
  });

  describe('spawn_timeout (legacy: status=Spawning, age > 5min, no container)', () => {
    it('supervisor classifies a stuck provisioning subagent as spawn_timeout', async () => {
      const now = DEFAULT_PROVISION_GRACE_MS + 1;
      const { service, captured } = buildSupervisor(
        [
          {
            id: SUBAGENT_ID,
            kind: 'subagent',
            state: 'provisioning',
            created_at: new Date(0),
            last_heartbeat_at: null,
            container_id: null,
          },
        ],
        false,
      );
      (service as unknown as { now: () => number }).now = () => now;

      await service.sweepOnce();

      // Parity: legacy reaper returned ABANDON_REASON_SPAWN_TIMEOUT here.
      expect(captured).toEqual([
        expect.objectContaining({
          executionId: SUBAGENT_ID,
          failure_reason: 'spawn_timeout',
        }),
      ]);
    });

    it('the reaped spawn_timeout produces the same observable subagent + session outcome as the legacy reaper', async () => {
      // A spawn_timeout victim never got a container.
      const harness = buildListeners(null, '');
      const envelope = buildReapedEnvelope(
        'spawn_timeout',
        'Execution did not reach running state within the spawn window',
      );

      await harness.reapedListener.onExecutionReaped(envelope);
      await fireCascade(harness.cascadeListener, envelope);

      // Parity 1: subagent_details satellite carries the Failed result.
      expect(harness.subagentDetailsUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          execution_id: SUBAGENT_ID,
          result: expect.objectContaining({
            status: 'Failed',
            failure_reason: 'spawn_timeout',
            reaped_at: expect.any(String),
            // No container existed, so diagnostics are null (legacy parity).
            container_diagnostics: null,
          }),
        }),
      );
      // Parity 2: mesh delegation cancelled with the same reason.
      expect(harness.handleSubagentCancellation).toHaveBeenCalledWith({
        subagentExecutionId: SUBAGENT_ID,
        reason: 'spawn_timeout',
      });
      // Parity 3: linked chat session marked FAILED via the idempotent writer.
      expect(harness.chatSessionFailIfNotTerminal).toHaveBeenCalledWith(
        CHAT_SESSION_ID,
        expect.objectContaining({ message: expect.any(String) }),
      );
    });
  });

  describe('container_lost (legacy: status=Running, container exited/dead/removing/404)', () => {
    it('supervisor classifies a continuously-lost subagent container as container_lost after the grace window', async () => {
      const { service, captured } = buildSupervisor(
        [
          {
            id: SUBAGENT_ID,
            kind: 'subagent',
            state: 'running',
            created_at: new Date(0),
            last_heartbeat_at: new Date(0),
            container_id: CHILD_CONTAINER_ID,
          },
        ],
        true,
      );
      const clock = { value: 0 };
      (service as unknown as { now: () => number }).now = () => clock.value;

      // First sweep only records the lost-since timestamp (debounce).
      await service.sweepOnce();
      expect(captured).toHaveLength(0);

      // After the grace window, the still-lost container is reaped.
      clock.value = DEFAULT_CONTAINER_LOST_GRACE_MS + 1;
      await service.sweepOnce();

      // Parity: legacy reaper returned ABANDON_REASON_CONTAINER_LOST here.
      expect(captured).toEqual([
        expect.objectContaining({
          executionId: SUBAGENT_ID,
          failure_reason: 'container_lost',
        }),
      ]);
    });

    it('the reaped container_lost produces the same observable subagent + session outcome as the legacy reaper', async () => {
      const harness = buildListeners(CHILD_CONTAINER_ID, 'runner crashed: OOM');
      const envelope = buildReapedEnvelope(
        'container_lost',
        'Execution container exited or was lost',
      );

      await harness.reapedListener.onExecutionReaped(envelope);
      await fireCascade(harness.cascadeListener, envelope);

      // Parity 1: subagent_details satellite carries the Failed result AND
      // captured container diagnostics — the legacy reaper's distinguishing
      // behaviour, now persisted on the satellite.
      expect(harness.subagentDetailsUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          execution_id: SUBAGENT_ID,
          result: expect.objectContaining({
            status: 'Failed',
            failure_reason: 'container_lost',
            error: 'Execution container exited or was lost',
            reaped_at: expect.any(String),
            container_diagnostics: expect.objectContaining({
              child_container_id: CHILD_CONTAINER_ID,
              logs_tail: 'runner crashed: OOM',
            }),
          }),
        }),
      );
      // Parity 2: mesh delegation cancelled with the same reason.
      expect(harness.handleSubagentCancellation).toHaveBeenCalledWith({
        subagentExecutionId: SUBAGENT_ID,
        reason: 'container_lost',
      });
      // Parity 3: linked chat session marked FAILED via the idempotent writer.
      expect(harness.chatSessionFailIfNotTerminal).toHaveBeenCalledWith(
        CHAT_SESSION_ID,
        expect.objectContaining({ message: expect.any(String) }),
      );
    });
  });
});

/**
 * The terminal router registers its handlers on the bus in onModuleInit; for a
 * seam test we invoke the cascade directly via the same registration path the
 * real bus would use, keeping the test independent of bus internals.
 */
async function fireCascade(
  listener: ChatSessionTerminalRouter,
  envelope: DomainEventEnvelope,
): Promise<void> {
  const handlers = new Map<string, (e: DomainEventEnvelope) => Promise<void>>();
  (
    listener as unknown as {
      bus: {
        on: (t: string, h: (e: DomainEventEnvelope) => Promise<void>) => void;
      };
    }
  ).bus = {
    on: (type, handler) => {
      handlers.set(type, handler);
    },
  };
  listener.onModuleInit();
  await handlers.get(EXECUTION_EVENT_TYPES.reaped)!(envelope);
}
