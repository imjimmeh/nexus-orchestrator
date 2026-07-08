import type { ExecutionState } from './execution-lifecycle.contracts';

export const TERMINAL_EXECUTION_STATES: ExecutionState[] = [
  'completed',
  'failed',
  'reaped',
  'cancelled',
];

export function isTerminalState(state: ExecutionState): boolean {
  return TERMINAL_EXECUTION_STATES.includes(state);
}

const LEGAL_EDGES: Record<ExecutionState, ExecutionState[]> = {
  pending: ['provisioning', 'reaped', 'cancelled', 'retry_scheduled'],
  provisioning: ['running', 'failed', 'reaped', 'cancelled'],
  running: [
    'running',
    'awaiting_input',
    'completing',
    'failed',
    'reaped',
    'cancelled',
  ],
  awaiting_input: ['running', 'completing', 'failed', 'reaped', 'cancelled'],
  completing: ['completed', 'failed', 'reaped'],
  retry_scheduled: ['pending', 'provisioning', 'cancelled', 'reaped'],
  completed: [],
  failed: [],
  reaped: [],
  cancelled: [],
};

export function isLegalTransition(
  from: ExecutionState,
  to: ExecutionState,
): boolean {
  return LEGAL_EDGES[from].includes(to);
}
