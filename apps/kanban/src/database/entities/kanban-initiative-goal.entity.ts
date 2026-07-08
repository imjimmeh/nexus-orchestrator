import { Entity, Index, PrimaryColumn } from "typeorm";

@Entity("kanban_initiative_goals")
@Index("idx_kanban_initiative_goals_goal_id", ["goal_id"])
export class KanbanInitiativeGoalEntity {
  @PrimaryColumn({ type: "uuid" })
  initiative_id!: string;

  @PrimaryColumn({ type: "uuid" })
  goal_id!: string;
}
