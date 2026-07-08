import { Injectable } from '@nestjs/common';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RememberBody,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { REMEMBER_RUNTIME_CAPABILITY } from '../../../workflow-runtime/workflow-runtime-capability.contracts';
import { RememberHandler } from '../../handlers/remember.handler';

@Injectable()
export class RememberTool implements IInternalToolHandler<RememberBody> {
  constructor(private readonly rememberHandler: RememberHandler) {}

  getName(): string {
    return 'remember';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return REMEMBER_RUNTIME_CAPABILITY;
  }

  execute(
    context: InternalToolExecutionContext,
    params: RememberBody,
  ): Promise<Record<string, unknown>> {
    return this.rememberHandler.remember(context, params);
  }
}
