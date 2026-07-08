import { describe, expect, it } from 'vitest';
import {
  PLANNER_NO_HONCHO_PATH,
  plan,
  planHonchoRouting,
} from './memory-query-planner';

/**
 * Pure-function tests for the `MemoryQueryPlanner` module.
 *
 * The planner has no DI, no IO, and no Nest testing module — it is
 * exercised by calling the exported `plan` (and Honcho-routing)
 * functions directly and asserting the returned `PlannedCall`
 * against the four-cell matrix documented in
 * `memory-query-planner.ts`.
 */
describe('MemoryQueryPlanner', () => {
  it('routes entityId+query → searchMemory with (entityType, entityId, query) tuple', () => {
    const result = plan({ entityType: 'User', entityId: 'u1', query: 'foo' });
    expect(result).toEqual({
      method: 'searchMemory',
      args: ['User', 'u1', 'foo'],
    });
  });

  it('routes entityId+undefined query → getMemorySegments with filters', () => {
    const result = plan({ entityType: 'User', entityId: 'u1' });
    expect(result).toEqual({
      method: 'getMemorySegments',
      args: ['User', 'u1', { memory_type: undefined }],
    });
  });

  it('routes no entityId+query → searchMemoryByType with filters', () => {
    const result = plan({ entityType: 'User', query: 'foo' });
    expect(result).toEqual({
      method: 'searchMemoryByType',
      args: ['User', 'foo', { memory_type: undefined }],
    });
  });

  it('routes no entityId+no query → getMemorySegmentsByType with filters', () => {
    const result = plan({ entityType: 'User' });
    expect(result).toEqual({
      method: 'getMemorySegmentsByType',
      args: ['User', { memory_type: undefined }],
    });
  });

  it('propagates memoryType through the no-entityId+no-query cell', () => {
    const result = plan({ entityType: 'User', memoryType: 'fact' });
    expect(result).toEqual({
      method: 'getMemorySegmentsByType',
      args: ['User', { memory_type: 'fact' }],
    });
  });

  it('accepts string | null for query and treats null as no query', () => {
    const result = plan({ entityType: 'User', entityId: 'u1', query: null });
    expect(result).toEqual({
      method: 'getMemorySegments',
      args: ['User', 'u1', { memory_type: undefined }],
    });
  });

  it('accepts string | undefined for query and treats undefined as no query', () => {
    const result = plan({
      entityType: 'User',
      entityId: 'u1',
      query: undefined,
    });
    expect(result).toEqual({
      method: 'getMemorySegments',
      args: ['User', 'u1', { memory_type: undefined }],
    });
  });

  it('treats whitespace-only query as no query (empty after trim) — routes to getMemorySegmentsByType when entityId also absent', () => {
    const result = plan({ entityType: 'User', query: '   ' });
    expect(result).toEqual({
      method: 'getMemorySegmentsByType',
      args: ['User', { memory_type: undefined }],
    });
  });

  it('treats whitespace-only query as no query — routes to getMemorySegments when entityId is present', () => {
    const result = plan({ entityType: 'User', entityId: 'u1', query: '   ' });
    expect(result).toEqual({
      method: 'getMemorySegments',
      args: ['User', 'u1', { memory_type: undefined }],
    });
  });

  it('trims surrounding whitespace before forwarding the query to searchMemory args', () => {
    const result = plan({
      entityType: 'User',
      entityId: 'u1',
      query: '  foo  ',
    });
    expect(result).toEqual({
      method: 'searchMemory',
      args: ['User', 'u1', 'foo'],
    });
  });
});

describe('MemoryQueryPlanner — planHonchoRouting (Drift D8 invariant)', () => {
  it('returns the entity-bound planned call when entityId is present (no outer recordFallback needed)', () => {
    const result = planHonchoRouting({
      entityType: 'User',
      entityId: 'u1',
      query: 'foo',
    });
    expect(result).toEqual({
      method: 'searchMemory',
      args: ['User', 'u1', 'foo'],
    });
  });

  it('returns the entity-bound planned call for getMemorySegments when entityId is present and no query', () => {
    const result = planHonchoRouting({
      entityType: 'User',
      entityId: 'u1',
    });
    expect(result).toEqual({
      method: 'getMemorySegments',
      args: ['User', 'u1', { memory_type: undefined }],
    });
  });

  it('returns PLANNER_NO_HONCHO_PATH when entityId is absent and a query is present (searchMemoryByType — Honcho cannot attempt)', () => {
    const result = planHonchoRouting({ entityType: 'User', query: 'foo' });
    expect(result).toBe(PLANNER_NO_HONCHO_PATH);
  });

  it('returns PLANNER_NO_HONCHO_PATH when both entityId and query are absent (getMemorySegmentsByType — Honcho cannot attempt)', () => {
    const result = planHonchoRouting({ entityType: 'User' });
    expect(result).toBe(PLANNER_NO_HONCHO_PATH);
  });
});
