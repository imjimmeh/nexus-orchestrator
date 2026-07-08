/**
 * Unit tests for the pure definition-change routing helpers (EPIC-D Task 8).
 *
 * These build the `ImprovementEvidencePayload` and proposal `provenance` for
 * a routed `agent_profile_change` / `workflow_definition_change` finding.
 * Split from `retrospective-output-router.service.ts` to keep that file under
 * the project's file-length cap.
 */
import { describe, expect, it } from 'vitest';
import type { RetrospectiveFinding } from '@nexus/core';
import {
  buildDefinitionChangeEvidence,
  buildDefinitionChangeProvenance,
} from './retrospective-output-router.definition-changes.helpers';

const ORIGINAL_RUN_ID = 'run-original-1';

function baseFinding(
  overrides: Partial<RetrospectiveFinding> = {},
): RetrospectiveFinding {
  return {
    kind: 'agent_profile_change',
    lesson: 'implementation-agent needs a stricter reminder',
    confidence_self: 0.9,
    evidence_event_ids: [],
    ...overrides,
  };
}

describe('buildDefinitionChangeEvidence', () => {
  it('flips evidence_class to struggle_backed when the run was struggle-backed', () => {
    const evidence = buildDefinitionChangeEvidence(
      baseFinding(),
      ORIGINAL_RUN_ID,
      true,
    );
    expect(evidence.evidenceClass).toBe('struggle_backed');
  });

  it('flips evidence_class to inference when the run was not struggle-backed', () => {
    const evidence = buildDefinitionChangeEvidence(
      baseFinding(),
      ORIGINAL_RUN_ID,
      false,
    );
    expect(evidence.evidenceClass).toBe('inference');
  });

  it('always cites the original run id in runIds', () => {
    const evidence = buildDefinitionChangeEvidence(
      baseFinding(),
      ORIGINAL_RUN_ID,
      false,
    );
    expect(evidence.runIds).toEqual([ORIGINAL_RUN_ID]);
  });

  it('mirrors the finding cited event ids as ledgerRefs', () => {
    const evidence = buildDefinitionChangeEvidence(
      baseFinding({ evidence_event_ids: ['evt-1', 'evt-2'] }),
      ORIGINAL_RUN_ID,
      false,
    );
    expect(evidence.ledgerRefs).toEqual(['evt-1', 'evt-2']);
  });

  it('omits ledgerRefs entirely when the finding cites no event ids', () => {
    const evidence = buildDefinitionChangeEvidence(
      baseFinding({ evidence_event_ids: [] }),
      ORIGINAL_RUN_ID,
      false,
    );
    expect(evidence.ledgerRefs).toBeUndefined();
  });
});

describe('buildDefinitionChangeProvenance', () => {
  it('marks the retrospective analyst as the proposal source with the original run id', () => {
    expect(buildDefinitionChangeProvenance(ORIGINAL_RUN_ID)).toEqual({
      source: 'retrospective_analyst',
      original_run_id: ORIGINAL_RUN_ID,
    });
  });
});
