import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAttachmentsTables20260610120000 implements MigrationInterface {
  name = 'CreateAttachmentsTables20260610120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attachments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "filename" varchar NOT NULL,
        "mime_type" varchar(255) NOT NULL,
        "size_bytes" integer NOT NULL,
        "checksum" varchar(64) NOT NULL,
        "storage_key" varchar NOT NULL,
        "parsed_key" varchar,
        "parse_status" varchar(32) NOT NULL DEFAULT 'pending',
        "parse_error" text,
        "created_by" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attachments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_attachments_checksum" ON "attachments" ("checksum")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attachment_links" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "attachment_id" uuid NOT NULL,
        "owner_type" varchar(64) NOT NULL,
        "owner_id" varchar NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attachment_links" PRIMARY KEY ("id"),
        CONSTRAINT "FK_attachment_links_attachment"
          FOREIGN KEY ("attachment_id") REFERENCES "attachments" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_attachment_link"
      ON "attachment_links" ("attachment_id", "owner_type", "owner_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_attachment_links_owner"
      ON "attachment_links" ("owner_type", "owner_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_attachment_links_owner"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_attachment_link"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attachment_links"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_attachments_checksum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attachments"`);
  }
}
