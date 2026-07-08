import { Module } from '@nestjs/common';
import { WorkflowCoreModule } from '../workflow/workflow-core.module';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [WorkflowCoreModule],
  controllers: [WebhookController],
})
export class WebhooksModule {
  /** External systems integration via webhooks */
  protected readonly _moduleName = 'WebhooksModule';
}
