import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workflow } from '../workflow/database/entities/workflow.entity';
import { AgentProfile } from '../ai-config/database/entities/agent-profile.entity';
import { Skill } from '../ai-config/database/entities/skill.entity';
import { ScopeModule } from '../scope/scope.module';
import { ScopedConfigResolver } from './scoped-config-resolver.service';
import { ConfigResolutionCache } from './config-resolution-cache.service';
import { WorkflowConfigSource } from './sources/workflow-config-source';
import { AgentProfileConfigSource } from './sources/agent-profile-config-source';
import { SkillConfigSource } from './sources/skill-config-source';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workflow, AgentProfile, Skill]),
    ScopeModule,
  ],
  providers: [
    ScopedConfigResolver,
    ConfigResolutionCache,
    WorkflowConfigSource,
    AgentProfileConfigSource,
    SkillConfigSource,
  ],
  exports: [ScopedConfigResolver, ConfigResolutionCache],
})
export class ConfigResolutionModule implements OnModuleInit {
  constructor(
    private readonly resolver: ScopedConfigResolver,
    private readonly workflowSource: WorkflowConfigSource,
    private readonly agentSource: AgentProfileConfigSource,
    private readonly skillSource: SkillConfigSource,
  ) {}

  onModuleInit(): void {
    this.resolver.register(this.workflowSource);
    this.resolver.register(this.agentSource);
    this.resolver.register(this.skillSource);
  }
}
