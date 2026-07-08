import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CharterRegenEnqueuer } from "./charter-regen.enqueuer";
import type {
  ProjectMemorySummary,
  ProjectMemoryType,
} from "./project-memory-summary.types";
import type { CharterMemoryRow } from "./project-memory-summary.service.types";
import type { KanbanProjectCharterItemEntity } from "../database/entities/kanban-project-charter-item.entity";
import { KanbanProjectCharterItemRepository } from "../database/repositories/kanban-project-charter-item.repository";

export type { CharterMemoryRow } from "./project-memory-summary.service.types";

type MemoryCountRow = {
  memory_type: string;
  count: number | string;
};

function isProjectMemoryType(value: string): value is ProjectMemoryType {
  return value === "preference" || value === "fact" || value === "history";
}

function isMissingMemoryTableError(error: unknown): boolean {
  const missingRelationMessage = 'relation "memory_segments" does not exist';
  return (
    error !== null &&
    typeof error === "object" &&
    (("code" in error && error.code === "42P01") ||
      ("message" in error &&
        typeof error.message === "string" &&
        error.message.includes(missingRelationMessage)))
  );
}

@Injectable()
export class ProjectMemorySummaryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly charterRegen: CharterRegenEnqueuer,
    private readonly charterItems: KanbanProjectCharterItemRepository,
  ) {}

  async getProjectMemorySummary(
    projectId: string,
  ): Promise<ProjectMemorySummary> {
    let rows: MemoryCountRow[];
    try {
      rows = await this.dataSource.query(
        `select memory_type, count(*)::int as count from memory_segments where entity_id = $1 group by memory_type`,
        [projectId],
      );
    } catch (error) {
      if (isMissingMemoryTableError(error)) {
        rows = [];
      } else {
        throw error;
      }
    }

    const byType: Record<ProjectMemoryType, number> = {
      preference: 0,
      fact: 0,
      history: 0,
    };

    for (const row of rows) {
      if (isProjectMemoryType(row.memory_type)) {
        byType[row.memory_type] = Number(row.count);
      }
    }

    return {
      entity_type: "project",
      entity_id: projectId,
      totalCount: byType.preference + byType.fact + byType.history,
      byType,
      retrievalTool: "query_memory",
    };
  }

  async getProjectMemorySegments(
    projectId: string,
    params: {
      limit: number;
      offset: number;
      memory_type?: string;
      query?: string;
    },
  ): Promise<{
    items: Record<string, unknown>[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = params.limit || 25;
    const offset = params.offset || 0;
    const memoryType = params.memory_type ?? null;
    const queryStr = params.query ?? null;

    let itemsQuery = `
      select id, content, memory_type, version, created_at, updated_at
      from memory_segments
      where entity_id = $1
    `;
    let countQuery = `
      select count(*)::int as count
      from memory_segments
      where entity_id = $1
    `;

    const sqlParams: unknown[] = [projectId];
    let paramIndex = 2;

    if (memoryType) {
      itemsQuery += ` and memory_type = $${paramIndex}`;
      countQuery += ` and memory_type = $${paramIndex}`;
      sqlParams.push(memoryType);
      paramIndex++;
    }

    if (queryStr) {
      itemsQuery += ` and content iLike $${paramIndex}`;
      countQuery += ` and content iLike $${paramIndex}`;
      sqlParams.push(`%${queryStr}%`);
      paramIndex++;
    }

    itemsQuery += ` order by updated_at desc limit $${paramIndex} offset $${paramIndex + 1}`;
    const itemsParams = [...sqlParams, limit, offset];

    let items: Record<string, unknown>[] = [];
    let total = 0;

    try {
      const [itemsRows, countRows] = (await Promise.all([
        this.dataSource.query(itemsQuery, itemsParams),
        this.dataSource.query(countQuery, sqlParams),
      ])) as [Record<string, unknown>[], { count: string | number }[]];
      items = itemsRows;
      total = Number(countRows[0]?.count ?? 0);
    } catch (error) {
      if (!isMissingMemoryTableError(error)) {
        throw error;
      }
    }

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  private toCharterRow(item: KanbanProjectCharterItemEntity): CharterMemoryRow {
    return {
      id: item.id,
      content: item.content,
      memory_type: item.memory_type,
      metadata: { category: item.category, source: item.source },
      created_at: item.created_at.toISOString(),
      updated_at: item.updated_at.toISOString(),
    };
  }

  async getCharterMemories(projectId: string): Promise<CharterMemoryRow[]> {
    const items = await this.charterItems.listByProject(projectId);
    return items.map((item) => this.toCharterRow(item));
  }

  async createCharterMemory(
    projectId: string,
    category: string,
    content: string,
    memoryType: string,
  ): Promise<CharterMemoryRow> {
    const item = await this.charterItems.create({
      project_id: projectId,
      category,
      content,
      memory_type: memoryType,
      source: "user_edit",
    });
    await this.charterRegen.enqueue(projectId);
    return this.toCharterRow(item);
  }

  async createProjectMemory(
    projectId: string,
    input: {
      category: string;
      content: string;
      source: string;
      memoryType?: string;
      confidence?: number;
    },
  ): Promise<CharterMemoryRow> {
    const memoryType =
      input.category === "preference"
        ? "preference"
        : (input.memoryType ?? "fact");
    const item = await this.charterItems.create({
      project_id: projectId,
      category: input.category,
      content: input.content,
      memory_type: memoryType,
      source: input.source,
    });
    await this.charterRegen.enqueue(projectId);
    return this.toCharterRow(item);
  }

  async updateCharterMemory(
    memoryId: string,
    projectId: string,
    content: string,
  ): Promise<CharterMemoryRow | null> {
    const item = await this.charterItems.updateContent(
      memoryId,
      projectId,
      content,
    );
    await this.charterRegen.enqueue(projectId);
    return item ? this.toCharterRow(item) : null;
  }

  async deleteCharterMemory(
    memoryId: string,
    projectId: string,
  ): Promise<boolean> {
    const deleted = await this.charterItems.deleteById(memoryId, projectId);
    await this.charterRegen.enqueue(projectId);
    return deleted;
  }
}
