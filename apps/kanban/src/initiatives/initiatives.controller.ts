import { Controller, Get, Param } from "@nestjs/common";
import { InitiativesService } from "./initiatives.service";

@Controller("projects/:project_id/initiatives")
export class InitiativesController {
  constructor(private readonly initiatives: InitiativesService) {}

  @Get()
  async list(@Param("project_id") project_id: string) {
    const data = await this.initiatives.listInitiatives(project_id);
    return { success: true, data };
  }
}
