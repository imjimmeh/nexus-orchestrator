import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ToolCatalogService } from '../tool-registry/tool-catalog.service';
import { CapabilityContractValidatorService } from './capability-contract-validator.service';
import { CapabilityRegistrarService } from '../tool-registry/capability-registrar.service';

@Injectable()
export class ToolSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ToolSeederService.name);

  constructor(
    private readonly toolCatalog: ToolCatalogService,
    private readonly capabilityRegistrar: CapabilityRegistrarService,
    private readonly contractValidator: CapabilityContractValidatorService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const builtInEntries = this.toolCatalog
      .getBuiltInCapabilityEntries()
      .map((entry) => ({
        ...entry,
        source: 'decorator_provider' as const,
      }));

    const summary =
      await this.capabilityRegistrar.registerCanonicalCapabilities(
        builtInEntries,
        {
          continueOnError: true,
        },
      );
    this.logger.log(
      `Capability registration summary: attempted=${summary.attempted.toString()} succeeded=${summary.succeeded.toString()} failed=${summary.failed.toString()} conflicts=${summary.conflicts.length.toString()}`,
    );

    await this.contractValidator.validateOrThrow();
  }
}
