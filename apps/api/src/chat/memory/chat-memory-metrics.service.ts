import { Injectable } from '@nestjs/common';
import type { ChatMemoryMetricsSnapshot } from './chat-memory.types';

@Injectable()
export class ChatMemoryMetricsService {
  private distillationSuccess = 0;
  private distillationFailure = 0;
  private promotionVolume = 0;
  private retrievalRequests = 0;
  private retrievalHits = 0;

  recordDistillationSuccess(): void {
    this.distillationSuccess += 1;
  }

  recordDistillationFailure(): void {
    this.distillationFailure += 1;
  }

  recordPromotion(): void {
    this.promotionVolume += 1;
  }

  recordRetrieval(hitCount: number): void {
    this.retrievalRequests += 1;
    if (hitCount > 0) {
      this.retrievalHits += 1;
    }
  }

  snapshot(): ChatMemoryMetricsSnapshot {
    const retrievalHitRate =
      this.retrievalRequests > 0
        ? this.retrievalHits / this.retrievalRequests
        : 0;

    return {
      distillationSuccess: this.distillationSuccess,
      distillationFailure: this.distillationFailure,
      promotionVolume: this.promotionVolume,
      retrievalRequests: this.retrievalRequests,
      retrievalHits: this.retrievalHits,
      retrievalHitRate,
    };
  }
}
