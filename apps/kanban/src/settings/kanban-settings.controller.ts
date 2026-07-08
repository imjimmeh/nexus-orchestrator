import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
} from "@nestjs/common";
import { UpdateKanbanSettingRequestSchema } from "@nexus/kanban-contracts";
import { KanbanSettingsService } from "./kanban-settings.service";

@Controller("kanban-settings")
export class KanbanSettingsController {
  constructor(private readonly settings: KanbanSettingsService) {}

  @Get()
  async list() {
    const data = await this.settings.getAll();
    return { success: true, data };
  }

  @Put(":key")
  async update(@Param("key") key: string, @Body() body: unknown) {
    const parsed = UpdateKanbanSettingRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.message);
    }

    const data = await this.settings.set(
      key,
      parsed.data.value,
      parsed.data.description,
    );
    return { success: true, data };
  }
}
