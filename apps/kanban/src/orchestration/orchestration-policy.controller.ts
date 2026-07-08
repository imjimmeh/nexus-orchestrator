import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { OrchestrationPolicyModeSchema } from "@nexus/kanban-contracts";
import { z, ZodError, type ZodType } from "zod";
import { KanbanPermissionsGuard } from "../common/kanban-permissions.guard";
import { OrchestrationPolicyService } from "./orchestration-policy.service";

const UpdatePolicySchema = z.object({
  entries: z.array(z.object({ key: z.string().min(1), value: z.unknown() })),
});

const PresetSchema = z.object({ mode: OrchestrationPolicyModeSchema });

@UseGuards(KanbanPermissionsGuard)
@Controller("orchestration")
export class OrchestrationPolicyController {
  constructor(private readonly policy: OrchestrationPolicyService) {}

  @Get(":projectId/policy")
  async resolve(@Param("projectId") projectId: string) {
    return { success: true, data: await this.policy.resolvePolicy(projectId) };
  }

  @Put(":projectId/policy")
  async update(@Param("projectId") projectId: string, @Body() body: unknown) {
    const { entries } = this.parseDto(UpdatePolicySchema, body);
    return {
      success: true,
      data: await this.policy.updatePolicy(projectId, entries),
    };
  }

  @Put(":projectId/policy/preset")
  async preset(@Param("projectId") projectId: string, @Body() body: unknown) {
    const { mode } = this.parseDto(PresetSchema, body);
    return {
      success: true,
      data: await this.policy.applyPreset(projectId, mode),
    };
  }

  private parseDto<TDto>(schema: ZodType<TDto>, value: unknown): TDto {
    try {
      return schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException(error.issues);
      }
      throw error;
    }
  }
}
