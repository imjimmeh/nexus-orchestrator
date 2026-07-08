import { describe, expect, it, vi } from 'vitest';
import { RecordStrategicIntentHandler } from './record-strategic-intent.handler';

describe('RecordStrategicIntentHandler', () => {
  it('delegates recordStrategicIntent to MemoryManagerService.upsertMemorySegment with a stamped payload', async () => {
    const memoryManager = {
      upsertMemorySegment: vi.fn().mockResolvedValue({
        id: 'segment-1',
        version: 1,
        memory_type: 'strategic_intent',
        updated_at: '2026-05-16T12:00:00.000Z',
      }),
    };

    const handler = new RecordStrategicIntentHandler(memoryManager as never);

    const params = {
      entity_type: 'project',
      entity_id: 'project-x',
      intent: {
        horizon: '30-day',
        priority_themes: ['evidence-first repairs'],
        focus_areas: ['reducing repair ambiguity'],
        constraints: ['no destructive sweeps'],
        updated_at: '2026-05-16T12:00:00.000Z',
        updated_by: 'ceo',
      },
    };

    const result = await handler.recordStrategicIntent(params);

    expect(memoryManager.upsertMemorySegment).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      entity_type: 'project',
      entity_id: 'project-x',
      segment_id: 'segment-1',
      version: 1,
      memory_type: 'strategic_intent',
      updated_at: '2026-05-16T12:00:00.000Z',
      intent: params.intent,
    });
  });
});
