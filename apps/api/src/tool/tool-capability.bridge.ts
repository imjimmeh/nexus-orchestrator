import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { IInternalToolHandler } from '@nexus/core';

/**
 * Generic bridge that discovers tools carrying a capability from the
 * aggregated tool array and wires each match into a target seam on init.
 *
 * Subclasses supply the two variable parts: the capability type guard
 * (`supports`) and the seam wiring action (`wire`).
 */
@Injectable()
export abstract class ToolCapabilityBridge<
  TCapability,
> implements OnModuleInit {
  constructor(protected readonly tools: IInternalToolHandler[]) {}

  /** Type guard: does this tool carry the capability? */
  protected abstract supports(
    tool: IInternalToolHandler,
  ): tool is IInternalToolHandler & TCapability;

  /** Wire a matching tool into its target seam. */
  protected abstract wire(tool: IInternalToolHandler & TCapability): void;

  onModuleInit(): void {
    for (const tool of this.tools) {
      if (this.supports(tool)) {
        this.wire(tool);
      }
    }
  }
}
