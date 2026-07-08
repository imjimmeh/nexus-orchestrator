import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  PluginLifecycleState,
  PluginLifecycleTransitionResult,
} from './plugin-kernel.types';

const ALLOWED_TRANSITIONS: Record<
  PluginLifecycleState,
  readonly PluginLifecycleState[]
> = {
  discovered: ['installed', 'quarantined', 'uninstalled'],
  installed: ['scanned', 'quarantined', 'uninstalled'],
  scanned: ['enabled', 'quarantined', 'uninstalled'],
  enabled: ['disabled', 'quarantined', 'uninstalled'],
  disabled: ['enabled', 'quarantined', 'uninstalled'],
  quarantined: ['uninstalled'],
  uninstalled: [],
};

function isPluginLifecycleState(value: unknown): value is PluginLifecycleState {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, value)
  );
}

function invalidLifecycleStateResult(
  from: PluginLifecycleState,
  to: PluginLifecycleState,
  invalidPosition: 'from' | 'to',
  invalidState: PluginLifecycleState,
): PluginLifecycleTransitionResult {
  return {
    allowed: false,
    from,
    to,
    reason: 'invalid_lifecycle_state',
    message: `Invalid plugin lifecycle ${invalidPosition} state: ${invalidState}.`,
  };
}

@Injectable()
export class PluginLifecycleStateMachineService {
  canTransition(from: PluginLifecycleState, to: PluginLifecycleState): boolean {
    if (!isPluginLifecycleState(from) || !isPluginLifecycleState(to)) {
      return false;
    }

    return ALLOWED_TRANSITIONS[from].includes(to);
  }

  getAllowedTransitions(from: PluginLifecycleState): PluginLifecycleState[] {
    if (!isPluginLifecycleState(from)) {
      return [];
    }

    return [...ALLOWED_TRANSITIONS[from]];
  }

  validateTransition(
    from: PluginLifecycleState,
    to: PluginLifecycleState,
  ): PluginLifecycleTransitionResult {
    if (!isPluginLifecycleState(from)) {
      return invalidLifecycleStateResult(from, to, 'from', from);
    }

    if (!isPluginLifecycleState(to)) {
      return invalidLifecycleStateResult(from, to, 'to', to);
    }

    if (this.canTransition(from, to)) {
      return { allowed: true, from, to };
    }

    return {
      allowed: false,
      from,
      to,
      reason: 'transition_not_allowed',
      message: `Plugin lifecycle transition from ${from} to ${to} is not allowed.`,
    };
  }

  assertTransitionAllowed(
    from: PluginLifecycleState,
    to: PluginLifecycleState,
  ): void {
    const result = this.validateTransition(from, to);

    if (!result.allowed) {
      throw new BadRequestException(result.message);
    }
  }
}
