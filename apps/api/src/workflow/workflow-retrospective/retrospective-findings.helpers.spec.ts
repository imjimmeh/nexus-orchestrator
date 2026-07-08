import { describe, expect, it } from 'vitest';
import {
  filterFindingsByEvidenceWithOutcomes,
  parseFindingsWithOutcomes,
} from './retrospective-findings.helpers';

describe('retrospective findings helpers', () => {
  describe('parseFindingsWithOutcomes', () => {
    it('normalizes numeric confidence strings', () => {
      const result = parseFindingsWithOutcomes([
        {
          kind: 'memory',
          lesson: 'Use workspace-relative eslint paths.',
          confidence_self: '0.72',
          evidence_event_ids: ['evt-1'],
        },
      ]);

      expect(result.valid).toHaveLength(1);
      expect(result.valid[0].confidence_self).toBe(0.72);
      expect(result.rejected).toHaveLength(0);
    });

    it('normalizes a single evidence item object when unambiguous', () => {
      const result = parseFindingsWithOutcomes([
        {
          kind: 'memory',
          lesson: 'Increase old-space for api lint.',
          confidence_self: 0.65,
          evidence_event_ids: { item: 'evt-1' },
        },
      ]);

      expect(result.valid[0].evidence_event_ids).toEqual(['evt-1']);
    });

    it('returns rejected outcomes for malformed findings', () => {
      const result = parseFindingsWithOutcomes([
        { kind: 'memory', confidence_self: 'not-a-number' },
      ]);

      expect(result.valid).toHaveLength(0);
      expect(result.rejected).toEqual([
        expect.objectContaining({ index: 0, reasonCode: 'schema_invalid' }),
      ]);
    });

    it('drops an empty-string assignment_targets instead of rejecting the finding', () => {
      const result = parseFindingsWithOutcomes([
        {
          kind: 'memory',
          lesson: 'Investigation subagents must use read, not grep/find.',
          confidence_self: 0.75,
          evidence_event_ids: ['evt-1'],
          working_procedure: '',
          assignment_targets: '',
        },
      ]);

      expect(result.rejected).toHaveLength(0);
      expect(result.valid).toHaveLength(1);
      expect(result.valid[0].working_procedure).toBeUndefined();
      expect(result.valid[0].assignment_targets).toBeUndefined();
    });

    it('drops empty-string optional root_cause/fix/scope_hint instead of rejecting the finding', () => {
      const result = parseFindingsWithOutcomes([
        {
          kind: 'memory',
          lesson: 'Use workspace-relative eslint paths.',
          confidence_self: 0.6,
          evidence_event_ids: ['evt-1'],
          root_cause: '',
          fix: '',
          scope_hint: '',
        },
      ]);

      expect(result.rejected).toHaveLength(0);
      expect(result.valid).toHaveLength(1);
      expect(result.valid[0].root_cause).toBeUndefined();
      expect(result.valid[0].fix).toBeUndefined();
      expect(result.valid[0].scope_hint).toBeUndefined();
    });

    it('preserves a genuinely populated assignment_targets array', () => {
      const result = parseFindingsWithOutcomes([
        {
          kind: 'skill_proposal',
          lesson: 'Cache the build output between retries.',
          confidence_self: 0.7,
          evidence_event_ids: ['evt-1'],
          working_procedure: 'Run the cache step before the build step.',
          assignment_targets: [{ agent_profile: 'builder' }],
        },
      ]);

      expect(result.valid).toHaveLength(1);
      expect(result.valid[0].assignment_targets).toEqual([
        { agent_profile: 'builder' },
      ]);
    });
  });

  describe('filterFindingsByEvidenceWithOutcomes', () => {
    it('reports rejected_evidence when all cited evidence ids are invalid', () => {
      const result = filterFindingsByEvidenceWithOutcomes(
        [
          {
            kind: 'memory',
            lesson: 'Use a narrower lint target.',
            confidence_self: 0.6,
            evidence_event_ids: ['evt-fake'],
          },
        ],
        new Set(['evt-real']),
      );

      expect(result.valid).toHaveLength(0);
      expect(result.rejected).toEqual([
        expect.objectContaining({ index: 0, reasonCode: 'evidence_missing' }),
      ]);
    });
  });
});
