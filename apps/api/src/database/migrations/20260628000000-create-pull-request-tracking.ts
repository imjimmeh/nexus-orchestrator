import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create the neutral `pull_request_tracking` table (EPIC-209 Phase 3). Maps a
 * hosted PR identity (provider, owner, repo, pr_number) to the originating
 * scope/context and workflow run so the Phase-4 reconciler can close the
 * lifecycle on an observed provider merge. Holds no downstream domain
 * identifiers.
 */
export class CreatePullRequestTracking20260628000000 implements MigrationInterface {
  public readonly transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pull_request_tracking (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" varchar(32) NOT NULL,
        "owner" varchar(200) NOT NULL,
        "repo" varchar(200) NOT NULL,
        "pr_number" integer NOT NULL,
        "scope_id" varchar(200) NOT NULL,
        "context_id" varchar(200) NOT NULL,
        "workflow_run_id" uuid NOT NULL,
        "head_branch" varchar(400) NOT NULL,
        "base_branch" varchar(400) NOT NULL,
        "pr_url" text NOT NULL,
        "github_secret_id" varchar(200) NOT NULL,
        "repository_url" text NOT NULL,
        "state" varchar(16) NOT NULL,
        "merge_commit_sha" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pull_request_tracking_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_pull_request_tracking_provider_owner_repo_number"
          UNIQUE ("provider", "owner", "repo", "pr_number")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pull_request_tracking_state"
        ON pull_request_tracking ("state");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS pull_request_tracking;`);
  }
}
