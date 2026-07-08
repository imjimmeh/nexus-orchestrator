import { Injectable } from "@nestjs/common";
import { ProjectGoalsService } from "../goals/project-goals.service";
import { ProjectMemorySummaryService } from "./project-memory-summary.service";
import type { CharterMemoryRow } from "./project-memory-summary.service";
import type { CharterAggregate } from "./charter-aggregate.service.types";

export type { CharterAggregate } from "./charter-aggregate.service.types";

@Injectable()
export class CharterAggregateService {
  constructor(
    private readonly goals: ProjectGoalsService,
    private readonly memories: ProjectMemorySummaryService,
  ) {}

  async getCharter(projectId: string): Promise<CharterAggregate> {
    const [goals, memories] = await Promise.all([
      this.goals.listGoals(projectId, false),
      this.memories.getCharterMemories(projectId),
    ]);
    const sections: Record<string, CharterMemoryRow[]> = {};
    let vision: CharterMemoryRow | null = null;
    for (const m of memories) {
      const cat =
        typeof m.metadata?.category === "string" ? m.metadata.category : "";
      if (cat === "vision") {
        vision = vision ?? m;
        continue;
      }
      (sections[cat] ??= []).push(m);
    }
    return { vision, goals, sections };
  }
}
