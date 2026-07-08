import { Injectable, Logger } from '@nestjs/common';
import { ToolRegistryRepository } from './database/repositories/tool-registry.repository';
import { CapabilityRegistryService } from '../capability-infra/capability-registry.service';
import type { CapabilityContractReport } from './capability-contract-validator.types';
import type { CapabilityManifestEntry } from '../capability-infra/capability-manifest.types';

const STRICT_VALIDATION_DEFAULT = true;

@Injectable()
export class CapabilityContractValidatorService {
  private readonly logger = new Logger(CapabilityContractValidatorService.name);

  constructor(
    private readonly toolRegistryRepo: ToolRegistryRepository,
    private readonly capabilityRegistry: CapabilityRegistryService,
  ) {}

  async validateOrThrow(): Promise<void> {
    const report = await this.validateContracts();

    if (report.ok) {
      this.logger.log('Capability contract validation passed');
      return;
    }

    for (const warning of report.warnings) {
      this.logger.warn(warning);
    }

    const strictValidation = this.resolveStrictValidation();
    const joinedErrors = report.errors.join(' | ');

    if (!strictValidation) {
      this.logger.warn(
        `Capability contract validation failed in warn-only mode: ${joinedErrors}`,
      );
      return;
    }

    throw new Error(`Capability contract validation failed: ${joinedErrors}`);
  }

  async validateContracts(): Promise<CapabilityContractReport> {
    const errors: string[] = [];
    const warnings: string[] = [];

    this.validateManifestDefinitions(errors);
    this.validateBridgeParity(errors);
    await this.validateRegistryParity(errors);
    this.validateNoDuplicateNames(
      this.capabilityRegistry.getDiscoveredEntries(),
    );

    return {
      ok: errors.length === 0,
      errors,
      warnings,
    };
  }

  private validateManifestDefinitions(errors: string[]): void {
    const seenNames = new Set<string>();
    const entries = this.capabilityRegistry.getDiscoveredEntries();

    for (const capability of entries) {
      if (seenNames.has(capability.name)) {
        errors.push(`Duplicate capability manifest entry: ${capability.name}`);
        continue;
      }
      seenNames.add(capability.name);

      if (!capability.schema || Object.keys(capability.schema).length === 0) {
        errors.push(
          `Capability ${capability.name} resolved to an empty JSON schema`,
        );
      }

      if (capability.transport === 'api_callback' && !capability.apiCallback) {
        errors.push(
          `Capability ${capability.name} declares api_callback transport but has no API callback config`,
        );
      }

      if (capability.transport !== 'api_callback' && capability.apiCallback) {
        errors.push(
          `Capability ${capability.name} declares non-api transport but still has API callback config`,
        );
      }
    }
  }

  private validateNoDuplicateNames(entries: CapabilityManifestEntry[]): void {
    const names = entries.map((e) => e.name);
    const duplicates = names.filter(
      (name, index) => names.indexOf(name) !== index,
    );
    if (duplicates.length > 0) {
      throw new Error(`Duplicate capability names: ${duplicates.join(', ')}`);
    }
  }

  private validateBridgeParity(errors: string[]): void {
    const discoveredBridgeActions =
      this.capabilityRegistry.getDiscoveredBridgeActions();
    const entries = this.capabilityRegistry.getDiscoveredEntries();

    for (const capability of entries) {
      if (!capability.bridgeAction) {
        continue;
      }

      if (!discoveredBridgeActions.has(capability.bridgeAction)) {
        errors.push(
          `Capability ${capability.name} references bridge action ${capability.bridgeAction} that was not discovered`,
        );
      }
    }
  }

  private async validateRegistryParity(errors: string[]): Promise<void> {
    const seededCapabilities =
      this.capabilityRegistry.getSeededCapabilityEntries();
    const expectedNames = new Set<string>(
      seededCapabilities.map(
        (capability: CapabilityManifestEntry) => capability.name,
      ),
    );

    const registeredTools = await this.toolRegistryRepo.findAll();
    const registeredNames = new Set<string>(
      registeredTools.map((tool) => tool.name),
    );

    for (const name of expectedNames) {
      if (!registeredNames.has(name)) {
        errors.push(
          `Capability ${name} is defined in manifest but missing from tool registry`,
        );
      }
    }
  }

  private resolveStrictValidation(): boolean {
    const rawValue = process.env.CAPABILITY_CONTRACT_STRICT;
    if (!rawValue) {
      return STRICT_VALIDATION_DEFAULT;
    }

    const normalized = rawValue.trim().toLowerCase();
    return !['0', 'false', 'off', 'no'].includes(normalized);
  }
}
