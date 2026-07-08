import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ChatMemorySchemaBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ChatMemorySchemaBootstrapService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureSchema();
      this.logger.log('Chat memory schema bootstrap completed');
    } catch (error) {
      this.logger.warn(
        `Chat memory schema bootstrap failed: ${(error as Error).message}`,
      );
    }
  }

  private async ensureSchema(): Promise<void> {
    await this.ensureChatSessionMemoryTable();
    await this.ensureChatProfileMemoryTable();
    await this.ensurePromotionAuditTable();
    await this.ensureMemoryJobsTable();
    await this.ensureMemoryEventsTable();
    await this.ensureIndexes();
  }

  private async ensureChatSessionMemoryTable(): Promise<void> {
    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS chat_session_memory (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        chat_session_id UUID NOT NULL,
        profile_id UUID NOT NULL,
        source_message_id UUID,
        source_role VARCHAR(32) NOT NULL,
        memory_type VARCHAR(32) NOT NULL DEFAULT 'history',
        content TEXT NOT NULL,
        normalized_content TEXT NOT NULL,
        importance_score SMALLINT NOT NULL DEFAULT 50,
        provenance JSONB,
        promoted_profile_memory_id UUID,
        distilled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  private async ensureChatProfileMemoryTable(): Promise<void> {
    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS chat_profile_memory (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        profile_id UUID NOT NULL,
        last_chat_session_id UUID,
        memory_type VARCHAR(32) NOT NULL DEFAULT 'fact',
        content TEXT NOT NULL,
        normalized_content TEXT NOT NULL,
        confidence_score SMALLINT NOT NULL DEFAULT 50,
        promotion_count INT NOT NULL DEFAULT 1,
        last_promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_accessed_at TIMESTAMPTZ,
        archived_at TIMESTAMPTZ,
        provenance JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  private async ensurePromotionAuditTable(): Promise<void> {
    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS chat_memory_promotion_audit (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        chat_session_id UUID,
        profile_id UUID NOT NULL,
        session_memory_id UUID,
        profile_memory_id UUID NOT NULL,
        action VARCHAR(16) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        trigger_reason VARCHAR(64) NOT NULL,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  private async ensureMemoryJobsTable(): Promise<void> {
    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS chat_memory_jobs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        job_type VARCHAR(32) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        chat_session_id UUID,
        profile_id UUID,
        idempotency_key VARCHAR(255) NOT NULL,
        trigger_reason VARCHAR(64) NOT NULL,
        payload JSONB,
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 3,
        scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  private async ensureMemoryEventsTable(): Promise<void> {
    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS chat_memory_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_id VARCHAR(128) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        correlation_id VARCHAR(128) NOT NULL,
        chat_session_id VARCHAR(128) NOT NULL,
        memory_id UUID NOT NULL,
        action VARCHAR(16) NOT NULL,
        profile_id UUID,
        envelope JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  private async ensureIndexes(): Promise<void> {
    const statements = [
      `CREATE INDEX IF NOT EXISTS idx_chat_session_memory_session_created ON chat_session_memory(chat_session_id, created_at);`,
      `CREATE INDEX IF NOT EXISTS idx_chat_session_memory_profile_created ON chat_session_memory(profile_id, created_at);`,
      `CREATE INDEX IF NOT EXISTS idx_chat_profile_memory_profile_updated ON chat_profile_memory(profile_id, updated_at);`,
      `CREATE INDEX IF NOT EXISTS idx_chat_profile_memory_profile_normalized ON chat_profile_memory(profile_id, normalized_content);`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_memory_promotion_audit_idempotency ON chat_memory_promotion_audit(idempotency_key);`,
      `CREATE INDEX IF NOT EXISTS idx_chat_memory_promotion_audit_profile_created ON chat_memory_promotion_audit(profile_id, created_at);`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_memory_jobs_idempotency ON chat_memory_jobs(idempotency_key);`,
      `CREATE INDEX IF NOT EXISTS idx_chat_memory_jobs_status_scheduled ON chat_memory_jobs(status, scheduled_at);`,
      `CREATE INDEX IF NOT EXISTS idx_chat_memory_events_type_created ON chat_memory_events(event_type, created_at);`,
      `CREATE INDEX IF NOT EXISTS idx_chat_memory_events_session_created ON chat_memory_events(chat_session_id, created_at);`,
    ];

    for (const statement of statements) {
      await this.runQuery(statement);
    }
  }

  private async runQuery(sql: string): Promise<void> {
    await this.dataSource.query(sql);
  }
}
