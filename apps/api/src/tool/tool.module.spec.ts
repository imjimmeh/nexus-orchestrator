import {
  GLOBAL_MODULE_METADATA,
  MODULE_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { CapabilityGovernanceModule } from '../capability-governance/capability-governance.module';
import { CapabilityInfraModule } from '../capability-infra/capability-infra.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { ToolContractRepairAdapter } from '../tool-runtime/tool-contract-repair.adapter';
import { ToolRuntimeModule } from '../tool-runtime/tool-runtime.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowRuntimeModule } from '../workflow/workflow-runtime/workflow-runtime.module';
import { WorkflowSpecialStepsModule } from '../workflow/workflow-special-steps/workflow-special-steps.module';
import { WorkflowStepExecutionModule } from '../workflow/workflow-step-execution/workflow-step-execution.module';
import { WorkflowSubagentsModule } from '../workflow/workflow-subagents/workflow-subagents.module';
import { SessionModule } from '../session/session.module';
import { CapabilityPreflightService } from './capability-preflight.service';
import { CapabilityContractValidatorService } from './capability-contract-validator.service';
import { ToolController } from './tool.controller';
import { ToolModule } from './tool.module';
import { ToolSeederService } from './tool-seeder.service';

function getModuleImports(moduleType: object): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) as unknown[];
}

function getModuleProviders(moduleType: object): unknown[] {
  return Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    moduleType,
  ) as unknown[];
}

function getModuleExports(moduleType: object): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.EXPORTS, moduleType) as unknown[];
}

describe('ToolModule', () => {
  it('is not global and delegates capability composition to focused modules', () => {
    const globalMetadata = Reflect.getMetadata(
      GLOBAL_MODULE_METADATA,
      ToolModule,
    ) as unknown;
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ToolModule,
    ) as unknown[];
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      ToolModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      ToolModule,
    ) as unknown[];

    expect(globalMetadata).toBeUndefined();
    expect(imports).toEqual(
      expect.arrayContaining([
        AuthorizationModule,
        CapabilityInfraModule,
        CapabilityGovernanceModule,
        ToolRegistryModule,
        ToolRuntimeModule,
      ]),
    );
    expect(imports).toHaveLength(7);
    expect(controllers).toEqual([ToolController]);
    expect(providers).toEqual(
      expect.arrayContaining([
        ToolSeederService,
        CapabilityContractValidatorService,
      ]),
    );
    expect(providers).not.toContain(ToolContractRepairAdapter);
    expect(getModuleExports(ToolModule)).not.toContain(
      ToolContractRepairAdapter,
    );
    expect(getModuleProviders(ToolRuntimeModule)).toContain(
      ToolContractRepairAdapter,
    );
    expect(getModuleExports(ToolRuntimeModule)).toContain(
      ToolContractRepairAdapter,
    );
  });

  it('keeps direct consumers wired to focused capability modules', () => {
    expect(getModuleImports(AiConfigModule)).toEqual(
      expect.arrayContaining([CapabilityInfraModule]),
    );
    expect(getModuleImports(AiConfigModule)).not.toContain(ToolModule);

    expect(getModuleImports(WorkflowRuntimeModule)).toEqual(
      expect.arrayContaining([
        CapabilityGovernanceModule,
        ToolRegistryModule,
        ToolRuntimeModule,
      ]),
    );
    expect(getModuleImports(WorkflowRuntimeModule)).not.toContain(ToolModule);

    expect(getModuleImports(WorkflowSpecialStepsModule)).toEqual(
      expect.arrayContaining([ToolRegistryModule, ToolRuntimeModule]),
    );
    expect(getModuleImports(WorkflowSpecialStepsModule)).not.toContain(
      ToolModule,
    );

    expect(getModuleImports(WorkflowStepExecutionModule)).toEqual(
      expect.arrayContaining([
        CapabilityGovernanceModule,
        CapabilityInfraModule,
        ToolRegistryModule,
        ToolRuntimeModule,
      ]),
    );
    expect(getModuleImports(WorkflowStepExecutionModule)).not.toContain(
      ToolModule,
    );
    expect(getModuleProviders(WorkflowStepExecutionModule)).toContain(
      CapabilityPreflightService,
    );

    expect(getModuleImports(WorkflowSubagentsModule)).toEqual(
      expect.arrayContaining([ToolRuntimeModule]),
    );

    expect(getModuleImports(WorkflowModule)).toEqual(
      expect.arrayContaining([
        CapabilityGovernanceModule,
        CapabilityInfraModule,
        ToolRegistryModule,
      ]),
    );
    expect(getModuleImports(WorkflowModule)).not.toContain(ToolModule);

    expect(getModuleImports(SessionModule)).not.toContain(ToolModule);
  });
});
