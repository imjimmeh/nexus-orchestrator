import {
  Controller,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
  Headers,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WorkflowParserService } from '../workflow/workflow-parser.service';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_PERSISTENCE_SERVICE,
} from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflowEngineService,
  IWorkflowPersistenceService,
} from '../workflow/kernel/interfaces/workflow-kernel.ports';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly workflowParser: WorkflowParserService,
  ) {}

  @Post('github')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Handle GitHub webhook events' })
  async handleGithub(
    @Body() payload: Record<string, unknown>,
    @Headers('x-hub-signature-256') githubSignature?: string,
    @Headers('x-nexus-signature') nexusSignature?: string,
  ) {
    this.verifySignature(githubSignature || nexusSignature, payload);
    this.logger.log(`Received GitHub webhook: ${JSON.stringify(payload)}`);

    const event =
      typeof payload.event === 'string' ? payload.event : 'github.event';
    const runIds = await this.triggerMatchingWorkflows(event, payload);

    return {
      success: true,
      message: 'Webhook received',
      data: { triggered_runs: runIds },
    };
  }

  @Post(':workflow_id')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger a specific workflow via generic webhook' })
  async triggerWorkflow(
    @Param('workflow_id') workflowId: string,
    @Body() payload: Record<string, unknown>,
    @Headers('x-nexus-signature') signature?: string,
  ) {
    this.verifySignature(signature, payload);
    this.logger.log(`Triggering workflow ${workflowId} via webhook`);
    const runId = await this.workflowEngine.startWorkflow(workflowId, payload);
    return { success: true, data: { runId } };
  }

  private verifySignature(
    signatureHeader: string | undefined,
    payload: Record<string, unknown>,
  ): void {
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new UnauthorizedException('Webhook secret is not configured');
    }

    if (!signatureHeader) {
      throw new UnauthorizedException('Webhook signature is required');
    }

    const normalizedHeader = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice('sha256='.length)
      : signatureHeader;

    const expected = createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    const receivedBuffer = Buffer.from(normalizedHeader, 'utf-8');
    const expectedBuffer = Buffer.from(expected, 'utf-8');

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  private async triggerMatchingWorkflows(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<string[]> {
    const workflows = await this.workflowPersistence.getAllWorkflows();
    const runIds: string[] = [];

    for (const workflow of workflows) {
      if (!workflow.is_active) {
        continue;
      }

      try {
        const definition = this.workflowParser.parseWorkflow(
          workflow.yaml_definition,
        );

        if (definition.trigger?.type !== 'webhook') {
          continue;
        }

        // Support both 'event' and 'name' fields; webhook triggers use 'event'
        const triggerEventName =
          definition.trigger.event || definition.trigger.name;
        if (triggerEventName && triggerEventName !== event) {
          continue;
        }

        const runId = await this.workflowEngine.startWorkflow(
          workflow.id,
          payload,
        );
        if (runId) {
          runIds.push(runId);
        }
      } catch (error) {
        this.logger.warn(
          `Skipping workflow ${workflow.id} for webhook event ${event}: ${(error as Error).message}`,
        );
      }
    }

    return runIds;
  }
}
