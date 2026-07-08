import { Injectable, Logger } from '@nestjs/common';
import { Parser, type Value } from 'expr-eval';
import { IWorkflowTransition } from '@nexus/core';

@Injectable()
export class StateMachineService {
  private readonly logger = new Logger(StateMachineService.name);

  evaluateTransition(
    transitions: IWorkflowTransition[] | undefined,
    context: Record<string, unknown>,
  ): string | null {
    if (!transitions || transitions.length === 0) {
      return null;
    }

    for (const transition of transitions) {
      try {
        const parsedCondition = transition.condition
          .replace(/&&/g, 'and')
          .replace(/\|\|/g, 'or');

        const result = Parser.evaluate(
          parsedCondition,
          context as Record<string, Value>,
        );
        if ((result as unknown) === true) {
          this.logger.debug(
            `Transition condition met: ${transition.condition}`,
          );
          return transition.next;
        }
      } catch (e) {
        const error = e as Error;
        const message = `Failed to evaluate transition condition "${transition.condition}": ${error.message}`;
        this.logger.error(message);
        throw new Error(message, { cause: e });
      }
    }

    return null;
  }
}
