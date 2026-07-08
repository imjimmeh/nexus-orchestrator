import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { seedKanbanPermissions } from "./seeds/kanban-permission.seed";

@Injectable()
export class AppService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await seedKanbanPermissions(this.dataSource);
    } catch (err) {
      this.logger.error(
        `Kanban permission seeding failed: ${(err as Error).message}`,
      );
    }
  }

  getHealthMessage(): string {
    return "Kanban service is running";
  }
}
