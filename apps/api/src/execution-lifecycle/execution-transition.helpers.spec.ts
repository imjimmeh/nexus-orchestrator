import { describe, expect, it } from 'vitest';
import {
  isLegalTransition,
  isTerminalState,
  TERMINAL_EXECUTION_STATES,
} from './execution-transition.helpers';

describe('execution transitions', () => {
  it('marks terminal states', () => {
    expect(TERMINAL_EXECUTION_STATES).toEqual([
      'completed',
      'failed',
      'reaped',
      'cancelled',
    ]);
    expect(isTerminalState('reaped')).toBe(true);
    expect(isTerminalState('running')).toBe(false);
  });

  it('allows pending -> provisioning -> running', () => {
    expect(isLegalTransition('pending', 'provisioning')).toBe(true);
    expect(isLegalTransition('provisioning', 'running')).toBe(true);
  });

  it('allows running <-> awaiting_input and running -> completing', () => {
    expect(isLegalTransition('running', 'awaiting_input')).toBe(true);
    expect(isLegalTransition('awaiting_input', 'running')).toBe(true);
    expect(isLegalTransition('running', 'completing')).toBe(true);
  });

  it('allows reaping from any non-terminal active state', () => {
    expect(isLegalTransition('running', 'reaped')).toBe(true);
    expect(isLegalTransition('provisioning', 'reaped')).toBe(true);
  });

  it('forbids leaving a terminal state', () => {
    expect(isLegalTransition('completed', 'running')).toBe(false);
    expect(isLegalTransition('reaped', 'failed')).toBe(false);
  });

  it('treats a self-transition as legal only for running heartbeat refresh', () => {
    expect(isLegalTransition('running', 'running')).toBe(true);
    expect(isLegalTransition('completed', 'completed')).toBe(false);
  });
});
