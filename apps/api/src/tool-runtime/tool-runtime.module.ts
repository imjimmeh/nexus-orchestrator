import { Module } from '@nestjs/common';
import { CapabilityGovernanceModule } from '../capability-governance/capability-governance.module';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { RuntimeFeedbackModule } from '../runtime-feedback/runtime-feedback.module';
import { SecurityModule } from '../security/security.module';
import { ToolCandidateService } from './tool-candidate.service';
import { ToolRuntimeExecutionService } from './tool-runtime-execution.service';
import { ToolSandboxService } from './tool-sandbox.service';
import { ToolMountingService } from './tool-mounting.service';
import { SkillMountingService } from './skill-mounting.service';
import { ToolContractRepairAdapter } from './tool-contract-repair.adapter';

@Module({
  imports: [
    CapabilityGovernanceModule,
    DatabaseModule,
    ObservabilityModule,
    RuntimeFeedbackModule,
    SecurityModule,
  ],
  providers: [
    ToolCandidateService,
    ToolRuntimeExecutionService,
    ToolSandboxService,
    ToolMountingService,
    SkillMountingService,
    ToolContractRepairAdapter,
  ],
  exports: [
    ToolCandidateService,
    ToolRuntimeExecutionService,
    ToolSandboxService,
    ToolMountingService,
    SkillMountingService,
    ToolContractRepairAdapter,
  ],
})
export class ToolRuntimeModule {
  protected readonly _moduleName = 'ToolRuntimeModule';
}
