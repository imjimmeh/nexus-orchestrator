import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  WEBHOOK_VERIFICATION_STRATEGIES,
  type WebhookVerificationStrategy,
} from './webhook-verification-strategy.types';

/** Resolves the verification strategy for a webhook route's provider segment. */
@Injectable()
export class WebhookVerificationStrategyRegistry {
  private readonly byKey: Map<string, WebhookVerificationStrategy>;

  constructor(
    @Inject(WEBHOOK_VERIFICATION_STRATEGIES)
    strategies: WebhookVerificationStrategy[],
  ) {
    this.byKey = new Map(strategies.map((s) => [s.providerKey, s]));
  }

  forProvider(providerKey: string): WebhookVerificationStrategy {
    const strategy = this.byKey.get(providerKey);
    if (!strategy) {
      throw new BadRequestException(
        `No webhook verification strategy for provider: ${providerKey}`,
      );
    }
    return strategy;
  }
}
