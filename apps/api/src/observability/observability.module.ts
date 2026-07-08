import { Module, forwardRef } from '@nestjs/common';
import { BaseRequestContextService } from '@nexus/core';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { RequestContextService } from '../common/request-context.service';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { CostTrackingService } from './cost-tracking.service';
import { EventLedgerService } from './event-ledger.service';
import { EventLedgerController } from './event-ledger.controller';

@Module({
  imports: [AuthModule, forwardRef(() => AuthorizationModule), DatabaseModule],
  providers: [
    MetricsService,
    CostTrackingService,
    RequestContextService,
    { provide: BaseRequestContextService, useExisting: RequestContextService },
    EventLedgerService,
  ],
  controllers: [MetricsController, EventLedgerController],
  exports: [
    MetricsService,
    CostTrackingService,
    RequestContextService,
    BaseRequestContextService,
    EventLedgerService,
  ],
})
export class ObservabilityModule {
  /** Observability and monitoring module */
  protected readonly _moduleName = 'ObservabilityModule';
}
