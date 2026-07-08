import { AuthModule } from '../../auth/auth.module';
import { AuthorizationModule } from '../../auth/authorization/authorization.module';
import { Module, forwardRef } from '@nestjs/common';
import { ToolRegistryModule } from '../../tool-registry/tool-registry.module';
import { WorkflowRuntimeModule } from '../workflow-runtime/workflow-runtime.module';
import { WorkflowDelegationToolProjectionService } from './workflow-delegation-tool-projection.service';
import { WorkflowDelegationToolsController } from './workflow-delegation-tools.controller';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => AuthorizationModule),
    ToolRegistryModule,
    WorkflowRuntimeModule,
  ],
  controllers: [WorkflowDelegationToolsController],
  providers: [WorkflowDelegationToolProjectionService],
  exports: [WorkflowDelegationToolProjectionService],
})
export class WorkflowDelegationToolsModule {}
