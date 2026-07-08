import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordLearningService } from './record-learning.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { LearningCandidateProposalListener } from './learning-candidate-proposal.listener';

describe('LearningCandidateProposalListener', () => {
  let settingsMock: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    settingsMock = { get: vi.fn().mockResolvedValue(false) };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeListener(
    recordLearning: ReturnType<typeof vi.fn>,
  ): LearningCandidateProposalListener {
    return new LearningCandidateProposalListener(
      { recordLearning } as unknown as RecordLearningService,
      settingsMock as unknown as SystemSettingsService,
    );
  }

  it('records a valid learning candidate proposal with neutral candidate fields', async () => {
    const recordLearning = vi.fn().mockResolvedValue({
      status: 'pending',
      candidate_id: 'candidate-1',
      created: true,
      fingerprint: 'fingerprint-1',
    });
    const listener = makeListener(recordLearning);
    const event = buildEventPayload();

    await listener.handleLearningCandidateProposed(event);

    expect(recordLearning).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        scope_type: 'external_project',
        scope_id: 'project-123',
        lesson: 'Run a deterministic retrospective after each completed cycle.',
        evidence: [
          {
            kind: 'external_retrospective_run',
            id: 'retro-789',
            summary: 'Cycle completed with repeat repair dispatches.',
          },
        ],
        confidence: 0.84,
        tags: ['external', 'retrospective'],
      }),
    );
  });

  it('records neutral event provenance without duplicating external project identity', async () => {
    const recordLearning = vi.fn().mockResolvedValue({
      status: 'pending',
      candidate_id: 'candidate-1',
      created: true,
      fingerprint: 'fingerprint-1',
    });
    const listener = makeListener(recordLearning);
    const event = buildEventPayload();

    await listener.handleLearningCandidateProposed(event);

    expect(recordLearning).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        provenance: expect.objectContaining({
          event_name: 'learning.candidate.proposed.v1',
          source_service: 'external',
          orchestration_id: 'orchestration-456',
          retrospective_run_id: 'retro-789',
          cycle_decision: 'complete',
          trigger: {
            type: 'completion_event',
            revision_marker: 'cycle-42',
          },
        }),
      }),
    );
    expect(recordLearning).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        provenance: expect.not.objectContaining({
          scope_id: 'project-123',
        }),
      }),
    );
  });

  it.each([
    ['scope_type', { scope_type: '' }],
    ['scope_id', { scope_id: '' }],
    ['lesson', { lesson: '   ' }],
    ['evidence', { evidence: [] }],
    [
      'evidence',
      { evidence: [{ kind: 'external_retrospective_run', id: 'retro-789' }] },
    ],
    ['evidence', { evidence: undefined }],
    ['confidence', { confidence: -0.01 }],
    ['confidence', { confidence: 1.01 }],
    ['confidence', { confidence: Number.POSITIVE_INFINITY }],
    ['tags', { tags: ['external', 42] }],
  ])(
    'ignores an invalid proposal payload with invalid %s',
    async (_field, override) => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const recordLearning = vi.fn();
      const listener = makeListener(recordLearning);

      await expect(
        listener.handleLearningCandidateProposed({
          ...buildEventPayload(),
          ...override,
        }),
      ).resolves.toBeUndefined();

      expect(recordLearning).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        'Ignoring invalid learning candidate proposal event payload.',
      );
    },
  );

  it('delegates duplicate handling to RecordLearningService without listener-level dedupe', async () => {
    const recordLearning = vi.fn().mockResolvedValue({
      status: 'pending',
      candidate_id: 'candidate-existing',
      created: false,
      fingerprint: 'fingerprint-1',
    });
    const listener = makeListener(recordLearning);
    const event = buildEventPayload();

    await listener.handleLearningCandidateProposed(event);
    await listener.handleLearningCandidateProposed(event);

    expect(recordLearning).toHaveBeenCalledTimes(2);
  });

  it('drops orchestration-cycle templated lessons when the gate is disabled (default)', async () => {
    settingsMock.get.mockResolvedValue(false);
    const recordLearning = vi.fn();
    const listener = makeListener(recordLearning);

    await listener.handleLearningCandidateProposed({
      scope_type: 'external_project',
      scope_id: 'proj-1',
      lesson:
        'Project proj-1 completed an orchestration cycle with 2 done items, 0 blocked items, and cycle decision repeat.',
      evidence: [
        {
          kind: 'orchestration_cycle',
          id: 'cycle-1',
          summary: 'Orchestration cycle completed.',
        },
      ],
      confidence: 0.6,
      tags: ['retrospective', 'orchestration-cycle'],
    });

    expect(recordLearning).not.toHaveBeenCalled();
  });

  it('drops the real production orchestration-cycle lesson format', async () => {
    settingsMock.get.mockResolvedValue(false);
    const recordLearning = vi.fn();
    const listener = makeListener(recordLearning);

    await listener.handleLearningCandidateProposed({
      scope_type: 'external_project',
      scope_id: '458935f0-213e-4bbe-89d1-8883e0efa9ad',
      lesson:
        'External project 458935f0-213e-4bbe-89d1-8883e0efa9ad completed an orchestration cycle with 5 done items, 2 blocked items, and cycle decision complete.',
      evidence: [
        {
          kind: 'orchestration_cycle',
          id: 'cycle-1',
          summary: 'Orchestration cycle completed.',
        },
      ],
      confidence: 0.6,
      tags: ['retrospective', 'orchestration-cycle'],
    });

    expect(recordLearning).not.toHaveBeenCalled();
  });

  it('still records non-templated lessons when the gate is disabled', async () => {
    settingsMock.get.mockResolvedValue(false);
    const recordLearning = vi.fn().mockResolvedValue({
      status: 'pending',
      candidate_id: 'candidate-1',
      created: true,
      fingerprint: 'fingerprint-1',
    });
    const listener = makeListener(recordLearning);

    await listener.handleLearningCandidateProposed({
      scope_type: 'external_project',
      scope_id: 'proj-1',
      lesson:
        'Splitting acceptance criteria per dispatch slot before dispatch avoided the overlapping-AC failure.',
      evidence: [
        {
          kind: 'practice',
          id: 'practice-1',
          summary: 'Best practice observed from cycle.',
        },
      ],
      confidence: 0.6,
      tags: ['retrospective'],
    });

    expect(recordLearning).toHaveBeenCalledTimes(1);
  });
});

function buildEventPayload(): Record<string, unknown> {
  return {
    scope_type: 'external_project',
    scope_id: 'project-123',
    lesson: 'Run a deterministic retrospective after each completed cycle.',
    evidence: [
      {
        kind: 'external_retrospective_run',
        id: 'retro-789',
        summary: 'Cycle completed with repeat repair dispatches.',
      },
    ],
    confidence: 0.84,
    tags: ['external', 'retrospective'],
    source_service: 'external',
    orchestration_id: 'orchestration-456',
    retrospective_run_id: 'retro-789',
    cycle_decision: 'complete',
    trigger: {
      type: 'completion_event',
      revision_marker: 'cycle-42',
    },
  };
}
