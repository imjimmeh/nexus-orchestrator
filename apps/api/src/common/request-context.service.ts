import { Injectable, OnModuleInit } from '@nestjs/common';
import { BaseRequestContextService } from '@nexus/core';
import { RequestContextLogger } from './logger.config';

export type { RequestContext } from '@nexus/core';

@Injectable()
export class RequestContextService
  extends BaseRequestContextService
  implements OnModuleInit
{
  onModuleInit(): void {
    // Bridge the AsyncLocalStorage to the Winston logger so it can read
    // request context even though it was created before DI.
    RequestContextLogger.init(this.storage);
  }

  getUserId(): string | undefined {
    return this.getContext()?.userId;
  }

  getWorkflowRunId(): string | undefined {
    return this.getContext()?.workflowRunId;
  }

  setUserId(userId: string): void {
    this.setContextValue('userId', userId);
  }

  setWorkflowRunId(workflowRunId: string): void {
    this.setContextValue('workflowRunId', workflowRunId);
  }
}
