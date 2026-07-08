import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { INTERNAL_TOOL_HANDLER } from './internal-tool.tokens';

@Injectable()
export class InternalToolRegistryService {
  private readonly handlerByName = new Map<string, IInternalToolHandler>();

  constructor(
    @Optional()
    @Inject(INTERNAL_TOOL_HANDLER)
    handlers: IInternalToolHandler[] = [],
  ) {
    for (const handler of handlers) {
      const name = handler.getName();
      if (this.handlerByName.has(name)) {
        throw new Error(
          `Duplicate internal tool handler registration for ${name}`,
        );
      }
      this.handlerByName.set(name, handler);
    }
  }

  getToolNames(): string[] {
    return Array.from(this.handlerByName.keys()).sort((a, b) =>
      a.localeCompare(b),
    );
  }

  getToolDefinitions(): RuntimeCapabilityDefinition[] {
    return Array.from(this.handlerByName.values()).map((handler) =>
      handler.getDefinition(),
    );
  }

  getHandler(name: string): IInternalToolHandler | undefined {
    return this.handlerByName.get(name);
  }

  getRequiredHandler(name: string): IInternalToolHandler {
    const handler = this.getHandler(name);
    if (!handler) {
      throw new NotFoundException(`Internal tool handler ${name} not found`);
    }
    return handler;
  }

  async executeTool(
    name: string,
    context: InternalToolExecutionContext,
    params: unknown,
  ): Promise<Record<string, unknown>> {
    const handler = this.getRequiredHandler(name);
    return handler.execute(context, params);
  }
}
