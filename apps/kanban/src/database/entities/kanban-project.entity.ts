import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import type { RuntimeToolchainConfig } from "@nexus/core";

@Entity("kanban_projects")
export class KanbanProjectEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "text", nullable: true })
  goals!: string | null;

  @Column({ name: "repository_url", type: "varchar", nullable: true })
  repository_url!: string | null;

  @Column({ name: "base_path", type: "varchar", nullable: true })
  base_path!: string | null;

  @Column({ name: "github_secret_id", type: "varchar", nullable: true })
  github_secret_id!: string | null;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ name: "source_type", type: "varchar", nullable: true })
  source_type!: string | null;

  @Column({ name: "copy_to_workspace", type: "boolean", nullable: true })
  copy_to_workspace!: boolean | null;

  @Column({ name: "allow_host_mounts", type: "simple-array", nullable: true })
  allow_host_mounts!: string[] | null;

  @Column({ name: "deny_host_mounts", type: "simple-array", nullable: true })
  deny_host_mounts!: string[] | null;

  @Column({ name: "allow_host_mount_rw", type: "simple-array", nullable: true })
  allow_host_mount_rw!: string[] | null;

  @Column({
    name: "repository_workflow_settings",
    type: "jsonb",
    default: () => `'{"enabled": true, "overrides": {}}'::jsonb`,
  })
  repository_workflow_settings!: Record<string, unknown>;

  @Column({
    name: "orchestration_settings",
    type: "jsonb",
    nullable: true,
  })
  orchestration_settings!: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true, default: null })
  runtime_toolchains?: RuntimeToolchainConfig | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
