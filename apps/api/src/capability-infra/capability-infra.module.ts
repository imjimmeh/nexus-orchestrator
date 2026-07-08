import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { CapabilityRegistryService } from './capability-registry.service';

@Module({
  imports: [DiscoveryModule],
  providers: [CapabilityRegistryService],
  exports: [CapabilityRegistryService],
})
export class CapabilityInfraModule {}
