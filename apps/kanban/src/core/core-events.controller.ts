import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  CoreWorkflowRunEventEnvelopeV1Schema,
  type CoreWorkflowRunEventEnvelopeV1Shape,
} from "@nexus/core";
import { InternalServiceAuthGuard } from "../common/internal-service-auth.guard";
import { InternalServiceScopes } from "../common/internal-service-scopes.decorator";
import { replayDeadLettersRequestSchema } from "./core-lifecycle-stream-dead-letter-replay.dto";
import { CoreLifecycleStreamConsumerService } from "./core-lifecycle-stream.consumer";
import { CoreRunProjectionService } from "./core-run-projection.service";

@UseGuards(InternalServiceAuthGuard)
@Controller("internal/core")
export class CoreEventsController {
  constructor(
    private readonly projectionService: CoreRunProjectionService,
    private readonly lifecycleConsumer: CoreLifecycleStreamConsumerService,
  ) {}

  @Post("events")
  @InternalServiceScopes("kanban.core-events:write")
  async ingestCoreEvent(@Body() body: CoreWorkflowRunEventEnvelopeV1Shape) {
    const parsed = CoreWorkflowRunEventEnvelopeV1Schema.parse(body);
    const projection =
      await this.projectionService.recordCoreLifecycleEvent(parsed);
    return { success: true, data: projection };
  }

  @Get("run-projections/:runId")
  @InternalServiceScopes("kanban.core-events:read")
  async getRunProjection(@Param("runId") runId: string) {
    const projection = await this.projectionService.getProjection(runId);
    return { success: true, data: projection };
  }

  @Get("run-projections/project/:project_id")
  @InternalServiceScopes("kanban.core-events:read")
  async listProjectRunProjections(@Param("project_id") project_id: string) {
    const projections = await this.projectionService.listByProject(project_id);
    return { success: true, data: projections };
  }

  @Post("lifecycle-stream/replay")
  @InternalServiceScopes("kanban.core-events:write")
  async replayLifecycleStream() {
    const result = await this.lifecycleConsumer.replayFromCursor();
    return { success: true, data: result };
  }

  @Post("lifecycle-stream/dead-letters/replay")
  @InternalServiceScopes("kanban.core-events:write")
  async replayDeadLetterStream(@Body() body: unknown) {
    const dto = replayDeadLettersRequestSchema.parse(body ?? {});
    const result = await this.lifecycleConsumer.replayDeadLetters(dto);
    return { success: true, data: result };
  }

  @Get("lifecycle-stream/health")
  @InternalServiceScopes("kanban.core-events:read")
  async getLifecycleProjectionHealth() {
    const diagnostics = await this.lifecycleConsumer.getDiagnostics();
    return { success: true, data: diagnostics };
  }
}
