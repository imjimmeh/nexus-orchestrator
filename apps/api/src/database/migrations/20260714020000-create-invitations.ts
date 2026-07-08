import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvitations20260714020000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS invitations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        token_hash varchar(64) NOT NULL,
        scope_node_id uuid NOT NULL REFERENCES scope_nodes(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        email varchar(320) NULL,
        invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status varchar(16) NOT NULL DEFAULT 'pending',
        expires_at timestamptz NOT NULL,
        accepted_by_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_token_hash ON invitations (token_hash);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_invitations_scope ON invitations (scope_node_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations (status);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS invitations;`);
  }
}
