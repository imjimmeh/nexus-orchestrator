import { Inject, Injectable } from '@nestjs/common';
import type { IInternalToolHandler } from '@nexus/core';
import { INTERNAL_TOOL_HANDLER } from '../../tool/internal-tool.tokens';
import { ToolCapabilityBridge } from '../../tool/tool-capability.bridge';
import { SystemPromptAssemblyService } from '../../system-prompt/system-prompt-assembly.service';
import type { ISystemPromptContributor } from '../../system-prompt/system-prompt-contributor.types';

/**
 * Discovers tools that also implement `ISystemPromptContributor` and
 * registers them with the system-prompt assembly seam on init.
 */
@Injectable()
export class ToolPromptContributorBridge extends ToolCapabilityBridge<ISystemPromptContributor> {
  constructor(
    @Inject(INTERNAL_TOOL_HANDLER) tools: IInternalToolHandler[],
    private readonly assembly: SystemPromptAssemblyService,
  ) {
    super(tools);
  }

  protected supports(
    tool: IInternalToolHandler,
  ): tool is IInternalToolHandler & ISystemPromptContributor {
    return (
      typeof (tool as Partial<ISystemPromptContributor>).contribute ===
      'function'
    );
  }

  protected wire(tool: IInternalToolHandler & ISystemPromptContributor): void {
    this.assembly.register(tool);
  }
}
