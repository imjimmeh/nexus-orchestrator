import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ZodError, type ZodType } from "zod";
import { listRetrospectivesSchema } from "./dto/list-retrospectives.dto";
import { runRetrospectiveSchema } from "./dto/run-retrospective.dto";
import { KanbanRetrospectiveService } from "./kanban-retrospective.service";

@Controller("retrospectives")
export class RetrospectivesController {
  constructor(private readonly retrospectives: KanbanRetrospectiveService) {}

  @Post("run")
  async run(@Body() body: unknown) {
    const dto = this.parseDto(runRetrospectiveSchema, body);
    const data = await this.retrospectives.runManualReplay(dto);
    return { success: true, data };
  }

  @Get("runs")
  async listRuns(@Query() query: unknown) {
    const dto = this.parseDto(listRetrospectivesSchema, query);
    const data = await this.retrospectives.listRuns(dto);
    return { success: true, data };
  }

  @Get("projects/:projectId/status")
  async getProjectStatus(@Param("projectId") projectId: string) {
    const data = await this.retrospectives.getProjectStatus(projectId);
    return { success: true, data };
  }

  private parseDto<TDto>(schema: ZodType<TDto>, value: unknown): TDto {
    try {
      return schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        const field = issue?.path[0];
        throw new BadRequestException(
          field === "project_id"
            ? "project_id is required"
            : (issue?.message ?? "Invalid retrospective request"),
        );
      }

      throw error;
    }
  }
}
