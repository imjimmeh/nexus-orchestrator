// apps/kanban/src/project/charter-aggregate.service.types.ts

import type { ProjectGoal } from "@nexus/kanban-contracts";
import type { CharterMemoryRow } from "./project-memory-summary.service";

export interface CharterAggregate {
  vision: CharterMemoryRow | null;
  goals: ProjectGoal[];
  sections: Record<string, CharterMemoryRow[]>;
}
