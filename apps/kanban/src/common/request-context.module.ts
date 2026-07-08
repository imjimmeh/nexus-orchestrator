import { Global, Module } from "@nestjs/common";
import { BaseRequestContextService } from "@nexus/core";

@Global()
@Module({
  providers: [BaseRequestContextService],
  exports: [BaseRequestContextService],
})
export class RequestContextModule {}
