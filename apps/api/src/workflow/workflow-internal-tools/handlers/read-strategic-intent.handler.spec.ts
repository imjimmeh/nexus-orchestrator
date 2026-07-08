import { describe, expect, it, vi } from 'vitest';
import { ReadStrategicIntentHandler } from './read-strategic-intent.handler';

describe('ReadStrategicIntentHandler', () => {
  it('returns a found projection when the segment exists', async () => {
    const segment = {
      id: 'segment-1',
      version: 2,
      updated_at: '2026-05-16T12:00:00.000Z',
      metadata_json: {
        horizon: '30-day',
        priority_themes: ['evidence-first repairs'],
        focus_areas: ['reducing repair ambiguity'],
        constraints: ['no destructive sweeps'],
        updated_at: '2026-05-16T12:00:00.000Z',
        updated_by: 'ceo',
      },
    };
    const memoryManager = {
      getStrategicIntentSegment: vi.fn().mockResolvedValue(segment),
    };

    const handler = new ReadStrategicIntentHandler(memoryManager as never);

    const result = await handler.readStrategicIntent({
      entity_type: 'project',
      entity_id: 'project-x',
    });

    expect(memoryManager.getStrategicIntentSegment).toHaveBeenCalledWith(
      'project',
      'project-x',
    );
    expect(result).toEqual({
      entity_type: 'project',
      entity_id: 'project-x',
      found: true,
      segment_id: 'segment-1',
      version: 2,
      updated_at: '2026-05-16T12:00:00.000Z',
      intent: segment.metadata_json,
    });
  });

  it('returns a not-found projection when the segment is missing', async () => {
    const memoryManager = {
      getStrategicIntentSegment: vi.fn().mockResolvedValue(null),
    };

    const handler = new ReadStrategicIntentHandler(memoryManager as never);

    const result = await handler.readStrategicIntent({
      entity_type: 'project',
      entity_id: 'project-x',
    });

    expect(result).toEqual({
      entity_type: 'project',
      entity_id: 'project-x',
      found: false,
      intent: null,
    });
  });
});
