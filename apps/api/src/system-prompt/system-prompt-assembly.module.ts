import { Module } from '@nestjs/common';
import { SystemPromptAssemblyService } from './system-prompt-assembly.service';

/**
 * Provides the shared system-prompt assembly seam. Consumers on both the
 * workflow agent-run path (StepSupportService) and chat sessions
 * (ChatSessionContextService) import this module explicitly to inject the
 * service.
 */
@Module({
  providers: [SystemPromptAssemblyService],
  exports: [SystemPromptAssemblyService],
})
export class SystemPromptAssemblyModule {}
