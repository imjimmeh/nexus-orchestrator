import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrMergeFinalizerService } from './pr-merge-finalizer.service';
import { WebhookSecretResolver } from './webhook-secret.resolver';
import { WebhookVerificationStrategyRegistry } from './webhook-verification-strategy.registry';
import type { WebhookHeaders } from './webhook-verification-strategy.types';

interface RawBodyRequest {
  rawBody?: Buffer;
}

@ApiTags('integration-webhooks')
@Controller('webhooks/integration')
export class PrWebhookController {
  constructor(
    private readonly finalizer: PrMergeFinalizerService,
    private readonly secretResolver: WebhookSecretResolver,
    private readonly registry: WebhookVerificationStrategyRegistry,
  ) {}

  @Post(':provider')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Provider pull/merge-request webhook ingress' })
  async handle(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest,
    @Body() body: unknown,
    @Headers() headers: WebhookHeaders,
  ): Promise<{ success: true; processed: boolean }> {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException('Missing webhook body');
    }

    const strategy = this.registry.forProvider(provider);
    const secret = await this.secretResolver.resolveSecret(null);
    if (!secret) {
      throw new UnauthorizedException('Webhook secret is not configured');
    }
    if (!strategy.verify(rawBody, headers, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const merge = strategy.extractMerge(body);
    if (!merge) {
      return { success: true, processed: false };
    }

    await this.finalizer.finalizeMergedByIdentity(merge);
    return { success: true, processed: true };
  }
}
