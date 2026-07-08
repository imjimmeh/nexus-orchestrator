import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGitopsRepositoryBindings20260611120000 implements MigrationInterface {
  name = 'CreateGitopsRepositoryBindings20260611120000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "gitops_repository_bindings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "scope_node_id" uuid NOT NULL,
        "name" text NOT NULL,
        "repo_url" text NOT NULL,
        "default_ref" text NOT NULL DEFAULT 'main',
        "root_path" text NOT NULL DEFAULT '.',
        "sync_mode" text NOT NULL,
        "credentials_secret_id" uuid,
        "enabled" boolean NOT NULL DEFAULT true,
        "included_object_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "conflict_policy" text NOT NULL DEFAULT 'require_review',
        "last_applied_revision" text,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gitops_repository_bindings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gitops_repository_bindings_scope_node" FOREIGN KEY ("scope_node_id") REFERENCES "scope_nodes" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_gitops_repository_bindings_scope_node_id"
      ON "gitops_repository_bindings" ("scope_node_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "gitops_reconcile_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "binding_id" uuid NOT NULL,
        "direction" text NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "revision" text NOT NULL,
        "summary" text,
        "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "started_at" TIMESTAMP,
        "finished_at" TIMESTAMP,
        "actor_user_id" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gitops_reconcile_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gitops_reconcile_runs_binding" FOREIGN KEY ("binding_id") REFERENCES "gitops_repository_bindings" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_gitops_reconcile_runs_binding_id"
      ON "gitops_reconcile_runs" ("binding_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_gitops_reconcile_runs_status"
      ON "gitops_reconcile_runs" ("status")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "gitops_pending_changes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "binding_id" uuid NOT NULL,
        "object_type" text NOT NULL,
        "object_key" text NOT NULL,
        "scope_node_id" uuid NOT NULL,
        "change_type" text NOT NULL,
        "payload" jsonb NOT NULL,
        "base_revision" text,
        "status" text NOT NULL DEFAULT 'pending',
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gitops_pending_changes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gitops_pending_changes_binding" FOREIGN KEY ("binding_id") REFERENCES "gitops_repository_bindings" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_gitops_pending_changes_scope_node" FOREIGN KEY ("scope_node_id") REFERENCES "scope_nodes" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_gitops_pending_changes_binding_id"
      ON "gitops_pending_changes" ("binding_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_gitops_pending_changes_status"
      ON "gitops_pending_changes" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_gitops_pending_changes_object_type_object_key"
      ON "gitops_pending_changes" ("object_type", "object_key")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_gitops_pending_changes_scope_node_id"
      ON "gitops_pending_changes" ("scope_node_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "gitops_pending_changes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "gitops_reconcile_runs"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "gitops_repository_bindings"`,
    );
  }
}
