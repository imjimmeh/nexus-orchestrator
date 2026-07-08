import { Controller, Get, Param } from "@nestjs/common";
import { ControlPlaneBoardService } from "./control-plane-board.service";

@Controller("projects/:project_id/control-plane")
export class ControlPlaneBoardController {
  constructor(private readonly board: ControlPlaneBoardService) {}

  @Get("board")
  async getBoard(@Param("project_id") projectId: string) {
    return {
      success: true,
      data: await this.board.getProjectBoard(projectId),
    };
  }
}
