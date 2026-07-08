import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { forbiddenActiveSchemaSurfacePattern } from '../../../test/helpers/api-baseline-boundary-patterns';
import { ApiPostCutoverBaseline20260517000000 } from './20260517000000-api-post-cutover-baseline';

describe('ApiPostCutoverBaseline20260517000000', () => {
  it('applies a frozen explicit SQL baseline without runtime schema generation', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const synchronize = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    const createSchemaBuilder = vi.fn();
    const queryRunner = {
      query,
      connection: {
        createSchemaBuilder,
        synchronize,
      },
    } as unknown as QueryRunner;

    await new ApiPostCutoverBaseline20260517000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const joinedStatements = statements.join('\n');

    expect(synchronize).not.toHaveBeenCalled();
    expect(createSchemaBuilder).not.toHaveBeenCalled();
    expect(statements[0]).toBe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    expect(statements[1]).toBe(
      'CREATE TABLE "workflows" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "yaml_definition" text NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5b5757cc1cd86268019fef52e0c" PRIMARY KEY ("id"));',
    );
    expect(joinedStatements).toContain('CREATE TABLE "workflow_runs"');
    expect(joinedStatements).toContain('CREATE TABLE "agent_profiles"');
    expect(joinedStatements).toContain('CREATE TABLE "chat_sessions"');
    expect(joinedStatements).toContain(
      'CREATE TABLE "runtime_feedback_signal_groups"',
    );
    expect(joinedStatements).toContain(
      '"source_context_item_id" character varying(255)',
    );
    expect(joinedStatements).toContain(
      'CREATE UNIQUE INDEX "uq_workflow_run_todos_run_context_item" ON "workflow_run_todos" ("workflow_run_id", "source_context_item_id") WHERE "source_context_item_id" IS NOT NULL;',
    );
    expect(joinedStatements).not.toMatch(forbiddenActiveSchemaSurfacePattern);
  });
});
