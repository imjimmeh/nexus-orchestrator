import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ExternalSyncService } from "./external-sync.service.js";
import type {
  ExternalConnectionCreateInput,
  ExternalConnectionUpdateInput,
} from "./external-sync.types.js";

@Controller("projects/:projectId/external-connections")
export class ExternalSyncController {
  constructor(private readonly externalSyncService: ExternalSyncService) {}

  @Post()
  async create(
    @Param("projectId") projectId: string,
    @Body() body: ExternalConnectionCreateInput,
  ) {
    const data = await this.externalSyncService.create(projectId, body);
    return { success: true, data };
  }

  @Get()
  async list(@Param("projectId") projectId: string) {
    const data = await this.externalSyncService.listByProject(projectId);
    return { success: true, data };
  }

  @Get(":id")
  async get(@Param("projectId") projectId: string, @Param("id") id: string) {
    const data = await this.externalSyncService.getByProjectAndId(
      projectId,
      id,
    );
    return { success: true, data };
  }

  @Patch(":id")
  async update(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Body() body: ExternalConnectionUpdateInput,
  ) {
    const data = await this.externalSyncService.updateByProjectAndId(
      projectId,
      id,
      body,
    );
    return { success: true, data };
  }

  @Delete(":id")
  async delete(@Param("projectId") projectId: string, @Param("id") id: string) {
    const data = await this.externalSyncService.deleteByProjectAndId(
      projectId,
      id,
    );
    return { success: true, data };
  }

  @Post(":id/test")
  async test(@Param("projectId") projectId: string, @Param("id") id: string) {
    const data = await this.externalSyncService.test(projectId, id);
    return { success: true, data };
  }

  @Post(":id/pause")
  async pause(@Param("projectId") projectId: string, @Param("id") id: string) {
    const data = await this.externalSyncService.pause(projectId, id);
    return { success: true, data };
  }

  @Post(":id/resume")
  async resume(@Param("projectId") projectId: string, @Param("id") id: string) {
    const data = await this.externalSyncService.resume(projectId, id);
    return { success: true, data };
  }

  @Post(":id/sync")
  async sync(@Param("projectId") projectId: string, @Param("id") id: string) {
    const data = await this.externalSyncService.sync(projectId, id);
    return { success: true, data };
  }

  @Post(":id/import")
  async import(@Param("projectId") projectId: string, @Param("id") id: string) {
    const data = await this.externalSyncService.import(projectId, id);
    return { success: true, data };
  }

  @Post(":id/export")
  async export(@Param("projectId") projectId: string, @Param("id") id: string) {
    const data = await this.externalSyncService.exportWorkItems(projectId, id);
    return { success: true, data };
  }

  @Get(":id/operations")
  async operations(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const parsedLimit = this.parsePositiveInt(limit, 50);
    const parsedOffset = this.parsePositiveInt(offset, 0);

    const data = await this.externalSyncService.listOperations(
      projectId,
      id,
      parsedLimit,
      parsedOffset,
    );
    return { success: true, data };
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (
      Number.isFinite(parsed) &&
      parsed >= 0 &&
      Number.isSafeInteger(parsed)
    ) {
      return parsed;
    }
    return fallback;
  }
}
