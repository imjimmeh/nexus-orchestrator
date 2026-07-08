import { Module } from '@nestjs/common';
import { BaseRequestContextService } from '@nexus/core';
import { RequestContextService } from './request-context.service';
@Module({
  providers: [
    RequestContextService,
    { provide: BaseRequestContextService, useExisting: RequestContextService },
  ],
  exports: [RequestContextService, BaseRequestContextService],
})
export class RequestContextModule {}
