import { Injectable } from "@nestjs/common";
import {
  CHARTER_SECTIONS,
  CHARTER_SECTION_TO_CATEGORY,
} from "@nexus/kanban-contracts";
import { ProjectGoalsService } from "../goals/project-goals.service";
import {
  ProjectMemorySummaryService,
  type CharterMemoryRow,
} from "./project-memory-summary.service";

@Injectable()
export class CharterDocRenderService {
  constructor(
    private readonly goals: ProjectGoalsService,
    private readonly memories: ProjectMemorySummaryService,
  ) {}

  private groupByCategory(
    memories: CharterMemoryRow[],
  ): Map<string, CharterMemoryRow[]> {
    const byCategory = new Map<string, CharterMemoryRow[]>();
    for (const m of memories) {
      const cat =
        typeof m.metadata?.category === "string" ? m.metadata.category : "";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      const rows = byCategory.get(cat);
      if (rows) rows.push(m);
    }
    return byCategory;
  }

  async render(projectId: string): Promise<string> {
    const [goals, memories] = await Promise.all([
      this.goals.listGoals(projectId, false),
      this.memories.getCharterMemories(projectId),
    ]);

    const byCategory = this.groupByCategory(memories);

    const parts: string[] = ["# Project Charter\n"];
    for (const section of CHARTER_SECTIONS) {
      parts.push(`## ${section}\n`);
      const category = CHARTER_SECTION_TO_CATEGORY[section];
      if (category === null) {
        // Goals — rendered from board goals, not memory
        if (goals.length === 0) {
          parts.push("_No goals defined._\n");
          continue;
        }
        for (const g of goals) {
          const tags = [g.status, g.moscow, g.priority]
            .filter(Boolean)
            .join(", ");
          parts.push(
            `- **${g.title}**${tags ? ` _(${tags})_` : ""}${g.description ? ` — ${g.description}` : ""}`,
          );
        }
        parts.push("");
      } else {
        const items = byCategory.get(category) ?? [];
        if (items.length === 0) {
          parts.push("_None captured._\n");
          continue;
        }
        for (const item of items) parts.push(`- ${item.content}`);
        parts.push("");
      }
    }
    return parts.join("\n");
  }
}
