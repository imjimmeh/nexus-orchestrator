/**
 * Unit tests for the drift-reference attachment on promotion
 * (EPIC-212 Phase-3 Task 4).
 *
 * Contract under test (`buildMetadata`):
 *   - A code-anchored candidate (evidence cites a repo file path) gets a
 *     top-level `filePath` drift reference in the EXACT shape the
 *     `MemoryDriftReferenceParser` classifies as `kind:'file'`, so the
 *     existing drift detector starts catching promoted lessons whose
 *     referenced file later disappears.
 *   - A non-code lesson gets NO drift reference — the metadata is
 *     byte-identical to the pre-Task-4 shape.
 *   - The shape is verified by feeding the written metadata back through
 *     the real `MemoryDriftReferenceParser`.
 */

import { describe, expect, it } from 'vitest';
import { buildMetadata } from './learning-promotion.helpers';
import { MemoryDriftReferenceParser } from '../memory-drift-reference.parser';
import { extractLessonAnchor } from '../signals/lesson-anchor.helper';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';
import type { LearningPromotionPolicyDecision } from './learning-promotion.types';

const DECISION: LearningPromotionPolicyDecision = {
  approved: true,
  code: 'approved',
  reason: 'ok',
  policyName: 'auto-learning-promotion',
  policyVersion: '1',
  minimumConfidence: 0.5,
  confidence: 0.8,
};

function buildCandidate(signals: Record<string, unknown>): LearningCandidate {
  return {
    id: 'candidate-1',
    scope_type: 'project',
    scopeId: 'scope-1',
    confidence: 0.8,
    summary: 'A lesson summary',
    title: 'A lesson',
    routing_target: null,
    signals_json: signals,
  } as unknown as LearningCandidate;
}

describe('buildMetadata — drift reference (Phase-3 Task 4)', () => {
  const parser = new MemoryDriftReferenceParser();

  it('attaches a file drift reference the parser classifies as kind:file for a code-anchored lesson', () => {
    const candidate = buildCandidate({
      lesson: 'The retry policy lives in this file',
      tags: ['repair'],
      evidence: [{ kind: 'code', path: 'apps/api/src/retry/policy.ts' }],
    });

    const metadata = buildMetadata(candidate, DECISION);

    // The drift reference is written in the parser's input shape.
    expect(metadata['filePath']).toBe('apps/api/src/retry/policy.ts');

    // Feeding the written metadata through the real parser classifies it.
    expect(parser.parse(metadata)).toEqual({
      kind: 'file',
      reference: 'apps/api/src/retry/policy.ts',
    });

    // And the Task-1 anchor helper resolves the same path (shared source).
    expect(extractLessonAnchor(metadata).path).toBe(
      'apps/api/src/retry/policy.ts',
    );
  });

  it('writes NO drift reference for a non-code lesson (byte-identical metadata)', () => {
    const candidate = buildCandidate({
      lesson: 'Prefer deterministic tests',
      tags: ['testing'],
      evidence: [
        { kind: 'job_output', id: 'job-1', summary: 'Repair succeeded' },
      ],
    });

    const metadata = buildMetadata(candidate, DECISION);

    expect(metadata['filePath']).toBeUndefined();
    expect('filePath' in metadata).toBe(false);
    expect(parser.parse(metadata)).toBeNull();
  });

  it('never throws on a candidate with no evidence and writes no drift reference', () => {
    const candidate = buildCandidate({ lesson: 'A bare lesson' });

    const metadata = buildMetadata(candidate, DECISION);

    expect('filePath' in metadata).toBe(false);
    expect(parser.parse(metadata)).toBeNull();
  });
});
