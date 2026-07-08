import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { WorkflowSkillBindingService } from './workflow-skill-binding.service';

/**
 * `WorkflowSkillBindingRepository` is not declared as a local provider: it
 * is one of `DatabaseModule`'s centrally-registered repositories (bound
 * against the shared `TypeOrmModule.forFeature(entities)` registration
 * there), so this module only needs to import `DatabaseModule` to inject
 * it into `WorkflowSkillBindingService`.
 */
@Module({
  imports: [DatabaseModule],
  providers: [WorkflowSkillBindingService],
  exports: [WorkflowSkillBindingService],
})
export class WorkflowSkillBindingsModule {}
