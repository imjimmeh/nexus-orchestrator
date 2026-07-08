import { forwardRef, Module } from "@nestjs/common";
import { CoreIntegrationModule } from "../../core/core-integration.module";
import { WorkItemModule } from "../work-item.module";
import { WorkItemCostEstimationController } from "./work-item-cost-estimation.controller";
import { WorkItemCostBucketStatsRefreshService } from "./work-item-cost-bucket-stats-refresh.service";
import { WorkItemCostEstimationService } from "./work-item-cost-estimation.service";

@Module({
  imports: [
    forwardRef(() => CoreIntegrationModule),
    forwardRef(() => WorkItemModule),
  ],
  controllers: [WorkItemCostEstimationController],
  providers: [
    WorkItemCostBucketStatsRefreshService,
    WorkItemCostEstimationService,
  ],
  exports: [
    WorkItemCostBucketStatsRefreshService,
    WorkItemCostEstimationService,
  ],
})
export class CostEstimationModule {
  protected readonly moduleName = CostEstimationModule.name;
}
