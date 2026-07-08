import { describe, expect, it } from 'vitest';
import { decideGovernanceAction } from './improvement-governance-policy.helpers';
import type {
  GovernanceMode,
  ImprovementEvidenceClass,
  ImprovementProposalKind,
} from '@nexus/core';

const KINDS: ImprovementProposalKind[] = [
  'skill_create',
  'skill_assignment',
  'workflow_definition_change',
  'agent_profile_change',
  'code_change',
];
const CLASSES: ImprovementEvidenceClass[] = ['struggle_backed', 'inference'];
const MODES: GovernanceMode[] = ['tiered', 'manual', 'autonomous'];

describe('decideGovernanceAction', () => {
  it('manual mode always proposes (given positive confidence)', () => {
    for (const kind of KINDS) {
      for (const evidenceClass of CLASSES) {
        expect(
          decideGovernanceAction({
            kind,
            evidenceClass,
            confidence: 0.9,
            mode: 'manual',
            overrides: {},
          }),
        ).toBe('propose');
      }
    }
  });

  it('tiered mode auto-applies only skill_assignment', () => {
    for (const kind of KINDS) {
      const action = decideGovernanceAction({
        kind,
        evidenceClass: 'struggle_backed',
        confidence: 0.7,
        mode: 'tiered',
        overrides: {},
      });
      expect(action).toBe(
        kind === 'skill_assignment' ? 'auto_apply' : 'propose',
      );
    }
  });

  it('autonomous struggle_backed at 0.7 auto-applies (>= 0.5 floor)', () => {
    expect(
      decideGovernanceAction({
        kind: 'workflow_definition_change',
        evidenceClass: 'struggle_backed',
        confidence: 0.7,
        mode: 'autonomous',
        overrides: {},
      }),
    ).toBe('auto_apply');
  });

  it('autonomous inference can never reach the 0.5 floor (capped at 0.45)', () => {
    expect(
      decideGovernanceAction({
        kind: 'code_change',
        evidenceClass: 'inference',
        confidence: 0.99,
        mode: 'autonomous',
        overrides: {},
      }),
    ).toBe('propose');
  });

  it('per-kind override beats the global mode', () => {
    expect(
      decideGovernanceAction({
        kind: 'workflow_definition_change',
        evidenceClass: 'struggle_backed',
        confidence: 0.7,
        mode: 'autonomous',
        overrides: { workflow_definition_change: 'manual' },
      }),
    ).toBe('propose');
  });

  it('zero confidence drops', () => {
    expect(
      decideGovernanceAction({
        kind: 'skill_create',
        evidenceClass: 'inference',
        confidence: 0,
        mode: 'autonomous',
        overrides: {},
      }),
    ).toBe('drop');
  });

  it('ui_operator provenance is exempt from the evidence-class confidence cap', () => {
    // Uncapped, 0.9 clears the 0.5 autonomous floor and auto-applies.
    // Without the exemption, `inference` would cap this at 0.45 and the
    // autonomous branch would fall through to 'propose' instead (see the
    // next test for that uncapped-vs-capped contrast).
    expect(
      decideGovernanceAction({
        kind: 'skill_assignment',
        evidenceClass: 'inference',
        confidence: 0.9,
        mode: 'autonomous',
        overrides: {},
        provenanceSource: 'ui_operator',
      }),
    ).toBe('auto_apply');
  });

  it('the same input without the ui_operator marker is capped and proposes instead', () => {
    expect(
      decideGovernanceAction({
        kind: 'skill_assignment',
        evidenceClass: 'inference',
        confidence: 0.9,
        mode: 'autonomous',
        overrides: {},
      }),
    ).toBe('propose');
  });

  it('tiered mode auto-applies an operator-directed skill_assignment (same as any other)', () => {
    expect(
      decideGovernanceAction({
        kind: 'skill_assignment',
        evidenceClass: 'inference',
        confidence: 1,
        mode: 'tiered',
        overrides: {},
        provenanceSource: 'ui_operator',
      }),
    ).toBe('auto_apply');
  });

  it('the ui_operator cap-exemption is scoped to skill_assignment: a code_change with the marker is STILL capped', () => {
    // inference caps at 0.45, below the 0.5 autonomous floor. If the
    // exemption leaked to code_change, this would auto-apply; scoping it to
    // skill_assignment keeps the higher-risk kind capped → 'propose'.
    expect(
      decideGovernanceAction({
        kind: 'code_change',
        evidenceClass: 'inference',
        confidence: 0.9,
        mode: 'autonomous',
        overrides: {},
        provenanceSource: 'ui_operator',
      }),
    ).toBe('propose');
  });

  it('an unrecognized provenanceSource value is not treated as the exemption marker', () => {
    expect(
      decideGovernanceAction({
        kind: 'skill_assignment',
        evidenceClass: 'inference',
        confidence: 0.9,
        mode: 'autonomous',
        overrides: {},
        provenanceSource: 'some_other_source',
      }),
    ).toBe('propose');
  });

  it('covers the full mode × kind × class × confidence grid without throwing', () => {
    for (const mode of MODES) {
      for (const kind of KINDS) {
        for (const evidenceClass of CLASSES) {
          for (const confidence of [0, 0.3, 0.45, 0.5, 0.7, 1]) {
            const action = decideGovernanceAction({
              kind,
              evidenceClass,
              confidence,
              mode,
              overrides: {},
            });
            expect(['auto_apply', 'propose', 'drop']).toContain(action);
          }
        }
      }
    }
  });
});
