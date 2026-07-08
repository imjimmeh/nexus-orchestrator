import { Module } from '@nestjs/common';
import { ShutdownStateService } from './shutdown-state.service';

@Module({
  providers: [ShutdownStateService],
  exports: [ShutdownStateService],
})
export class ShutdownStateModule {}
