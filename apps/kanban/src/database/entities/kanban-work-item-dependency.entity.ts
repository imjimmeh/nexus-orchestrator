import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("kanban_work_item_dependencies")
@Index(
  "uq_kanban_work_item_dependencies_pair",
  ["work_item_id", "depends_on_work_item_id"],
  { unique: true },
)
@Index("idx_kanban_work_item_dependencies_depends_on", [
  "depends_on_work_item_id",
])
export class KanbanWorkItemDependencyEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  work_item_id!: string;

  @Column({ type: "uuid" })
  depends_on_work_item_id!: string;
}
