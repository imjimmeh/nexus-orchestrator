import { describe, expect, it } from 'vitest';
import {
  InvalidPromotionTransitionError,
  PromotionEvent,
  PromotionState,
} from './learning-promotion.state.types';
import {
  __TRANSITIONS_FOR_TESTING__,
  isPromotionTerminalState,
  transition,
} from './learning-promotion.state';

describe('PromotionState state machine', () => {
  describe('legal transitions', () => {
    const legalEdges: ReadonlyArray<{
      from: PromotionState;
      event: PromotionEvent;
      to: PromotionState;
    }> = [
      {
        from: PromotionState.IDLE,
        event: 'CANDIDATE_FOUND',
        to: PromotionState.CANDIDATE_LOADED,
      },
      {
        from: PromotionState.IDLE,
        event: 'CANDIDATE_NOT_FOUND',
        to: PromotionState.CANDIDATE_MISSING,
      },
      {
        from: PromotionState.CANDIDATE_LOADED,
        event: 'ALREADY_PROMOTED',
        to: PromotionState.RETURNED_EXISTING_PROMOTION,
      },
      {
        from: PromotionState.CANDIDATE_LOADED,
        event: 'PENDING_PROMOTION',
        to: PromotionState.CLAIMING_PROMOTION,
      },
      {
        from: PromotionState.CLAIMING_PROMOTION,
        event: 'CLAIM_ACQUIRED',
        to: PromotionState.CLAIM_ACQUIRED,
      },
      {
        from: PromotionState.CLAIMING_PROMOTION,
        event: 'CLAIM_LOST',
        to: PromotionState.CLAIM_LOST,
      },
      {
        from: PromotionState.CLAIM_ACQUIRED,
        event: 'GOVERNANCE_DROP',
        to: PromotionState.DROPPED_BY_GOVERNANCE,
      },
      {
        from: PromotionState.CLAIM_ACQUIRED,
        event: 'GOVERNANCE_SKILL_ROUTE',
        to: PromotionState.ROUTED_TO_SKILL_PROPOSAL,
      },
      {
        from: PromotionState.CLAIM_ACQUIRED,
        event: 'GOVERNANCE_REQUIRES_PROPOSAL',
        to: PromotionState.REQUIRES_PROPOSAL,
      },
      {
        from: PromotionState.CLAIM_ACQUIRED,
        event: 'GOVERNANCE_AUTO_PROMOTE',
        to: PromotionState.EVALUATING_POLICY,
      },
      {
        from: PromotionState.EVALUATING_POLICY,
        event: 'POLICY_APPROVED',
        to: PromotionState.WRITING_MEMORY_SEGMENT,
      },
      {
        from: PromotionState.EVALUATING_POLICY,
        event: 'POLICY_DENIED',
        to: PromotionState.POLICY_DENIED,
      },
      {
        from: PromotionState.WRITING_MEMORY_SEGMENT,
        event: 'MEMORY_SEGMENT_READY',
        to: PromotionState.FINALIZING_PROMOTION,
      },
      {
        from: PromotionState.WRITING_MEMORY_SEGMENT,
        event: 'MEMORY_WRITE_FAILED',
        to: PromotionState.PROMOTION_FAILED,
      },
      {
        from: PromotionState.FINALIZING_PROMOTION,
        event: 'PROMOTION_MARKED',
        to: PromotionState.PROMOTED,
      },
      {
        from: PromotionState.FINALIZING_PROMOTION,
        event: 'PROMOTION_RACE_LOST',
        to: PromotionState.PROMOTION_RACE_LOST,
      },
      {
        from: PromotionState.FINALIZING_PROMOTION,
        event: 'FINALIZE_FAILED',
        to: PromotionState.PROMOTION_FAILED,
      },
    ];

    for (const edge of legalEdges) {
      it(`advances from ${edge.from} on ${edge.event} to ${edge.to}`, () => {
        expect(transition(edge.from, edge.event)).toBe(edge.to);
      });
    }
  });

  describe('invalid transitions', () => {
    it('throws when an event has no legal edge from the current state', () => {
      expect(() => transition(PromotionState.IDLE, 'PROMOTION_MARKED')).toThrow(
        InvalidPromotionTransitionError,
      );
    });

    it('throws from a terminal state for every event', () => {
      const terminalStates: PromotionState[] = [
        PromotionState.CANDIDATE_MISSING,
        PromotionState.RETURNED_EXISTING_PROMOTION,
        PromotionState.CLAIM_LOST,
        PromotionState.DROPPED_BY_GOVERNANCE,
        PromotionState.ROUTED_TO_SKILL_PROPOSAL,
        PromotionState.REQUIRES_PROPOSAL,
        PromotionState.POLICY_DENIED,
        PromotionState.PROMOTED,
        PromotionState.PROMOTION_RACE_LOST,
        PromotionState.PROMOTION_FAILED,
      ];
      const events: PromotionEvent[] = [
        'CANDIDATE_FOUND',
        'ALREADY_PROMOTED',
        'PROMOTION_MARKED',
        'POLICY_APPROVED',
        'GOVERNANCE_AUTO_PROMOTE',
      ];
      for (const state of terminalStates) {
        for (const event of events) {
          expect(() => transition(state, event)).toThrow(
            InvalidPromotionTransitionError,
          );
        }
      }
    });

    it('attaches the offending (state, event) on the thrown error', () => {
      try {
        transition(PromotionState.PROMOTED, 'POLICY_APPROVED');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidPromotionTransitionError);
        const typed = error as InvalidPromotionTransitionError;
        expect(typed.state).toBe(PromotionState.PROMOTED);
        expect(typed.event).toBe('POLICY_APPROVED');
        return;
      }
      throw new Error('expected transition() to throw');
    });
  });

  describe('terminal state classification', () => {
    it('classifies success terminals', () => {
      expect(
        isPromotionTerminalState(PromotionState.RETURNED_EXISTING_PROMOTION),
      ).toBe(true);
      expect(
        isPromotionTerminalState(PromotionState.DROPPED_BY_GOVERNANCE),
      ).toBe(true);
      expect(
        isPromotionTerminalState(PromotionState.ROUTED_TO_SKILL_PROPOSAL),
      ).toBe(true);
      expect(isPromotionTerminalState(PromotionState.REQUIRES_PROPOSAL)).toBe(
        true,
      );
      expect(isPromotionTerminalState(PromotionState.PROMOTED)).toBe(true);
      expect(isPromotionTerminalState(PromotionState.PROMOTION_RACE_LOST)).toBe(
        true,
      );
    });

    it('classifies error terminals', () => {
      expect(isPromotionTerminalState(PromotionState.CANDIDATE_MISSING)).toBe(
        true,
      );
      expect(isPromotionTerminalState(PromotionState.CLAIM_LOST)).toBe(true);
      expect(isPromotionTerminalState(PromotionState.POLICY_DENIED)).toBe(true);
      expect(isPromotionTerminalState(PromotionState.PROMOTION_FAILED)).toBe(
        true,
      );
    });

    it('does NOT classify non-terminals', () => {
      expect(isPromotionTerminalState(PromotionState.IDLE)).toBe(false);
      expect(isPromotionTerminalState(PromotionState.CANDIDATE_LOADED)).toBe(
        false,
      );
      expect(isPromotionTerminalState(PromotionState.CLAIMING_PROMOTION)).toBe(
        false,
      );
      expect(isPromotionTerminalState(PromotionState.CLAIM_ACQUIRED)).toBe(
        false,
      );
      expect(isPromotionTerminalState(PromotionState.EVALUATING_POLICY)).toBe(
        false,
      );
      expect(
        isPromotionTerminalState(PromotionState.WRITING_MEMORY_SEGMENT),
      ).toBe(false);
      expect(
        isPromotionTerminalState(PromotionState.FINALIZING_PROMOTION),
      ).toBe(false);
    });
  });

  describe('happy-path sequence', () => {
    it('walks IDLE → ... → PROMOTED with the events the real flow emits', () => {
      let state: PromotionState = PromotionState.IDLE;

      state = transition(state, 'CANDIDATE_FOUND');
      expect(state).toBe(PromotionState.CANDIDATE_LOADED);

      state = transition(state, 'PENDING_PROMOTION');
      expect(state).toBe(PromotionState.CLAIMING_PROMOTION);

      state = transition(state, 'CLAIM_ACQUIRED');
      expect(state).toBe(PromotionState.CLAIM_ACQUIRED);

      state = transition(state, 'GOVERNANCE_AUTO_PROMOTE');
      expect(state).toBe(PromotionState.EVALUATING_POLICY);

      state = transition(state, 'POLICY_APPROVED');
      expect(state).toBe(PromotionState.WRITING_MEMORY_SEGMENT);

      state = transition(state, 'MEMORY_SEGMENT_READY');
      expect(state).toBe(PromotionState.FINALIZING_PROMOTION);

      state = transition(state, 'PROMOTION_MARKED');
      expect(state).toBe(PromotionState.PROMOTED);

      expect(isPromotionTerminalState(state)).toBe(true);
    });
  });

  describe('transition table shape', () => {
    it('lists one entry per legal edge declared in the spec', () => {
      const edgeCount = Object.values(__TRANSITIONS_FOR_TESTING__).reduce(
        (sum, transitions) => sum + Object.keys(transitions).length,
        0,
      );
      // 17 edges enumerated in the `legal transitions` describe block.
      expect(edgeCount).toBe(17);
    });

    it('contains no self-loops (every legal edge moves to a distinct state)', () => {
      const selfLoops: Array<{ state: PromotionState; event: PromotionEvent }> =
        [];
      for (const [stateKey, transitions] of Object.entries(
        __TRANSITIONS_FOR_TESTING__,
      )) {
        const state = stateKey as PromotionState;
        for (const eventKey of Object.keys(transitions)) {
          const event = eventKey as PromotionEvent;
          if (transitions[event] === state) {
            selfLoops.push({ state, event });
          }
        }
      }
      expect(selfLoops).toEqual([]);
    });
  });
});
