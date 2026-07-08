import { describe, expect, it } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ToolRuntimeModule } from './tool-runtime.module';
import { ToolCandidateService } from './tool-candidate.service';
import { ToolRuntimeExecutionService } from './tool-runtime-execution.service';
import { ToolSandboxService } from './tool-sandbox.service';
import { ToolMountingService } from './tool-mounting.service';
import { SkillMountingService } from './skill-mounting.service';

describe('ToolRuntimeModule', () => {
  it('owns runtime providers and exports', () => {
    const providers =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ToolRuntimeModule) ?? [];
    const exportsList =
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, ToolRuntimeModule) ?? [];

    expect(providers).toEqual(
      expect.arrayContaining([
        ToolCandidateService,
        ToolRuntimeExecutionService,
        ToolSandboxService,
        ToolMountingService,
        SkillMountingService,
      ]),
    );
    expect(exportsList).toEqual(
      expect.arrayContaining([
        ToolCandidateService,
        ToolRuntimeExecutionService,
        ToolSandboxService,
        ToolMountingService,
        SkillMountingService,
      ]),
    );
  });
});
