import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateDomainEventOutbox20260608120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'domain_event_outbox',
        columns: [
          { name: 'event_id', type: 'uuid', isPrimary: true },
          { name: 'event_type', type: 'varchar', length: '255' },
          { name: 'aggregate_id', type: 'varchar', length: '255' },
          { name: 'aggregate_type', type: 'varchar', length: '255' },
          { name: 'payload', type: 'jsonb' },
          {
            name: 'correlation_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'causation_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          { name: 'occurred_at', type: 'timestamptz' },
          {
            name: 'delivery_status',
            type: 'varchar',
            length: '50',
            default: "'pending'",
          },
          { name: 'attempt_count', type: 'integer', default: '0' },
          { name: 'last_error', type: 'text', isNullable: true },
          { name: 'persisted_at', type: 'timestamptz', default: 'now()' },
        ],
        checks: [
          {
            name: 'chk_domain_event_outbox_delivery_status',
            expression: "delivery_status IN ('pending', 'delivered', 'failed')",
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'domain_event_outbox',
      new TableIndex({
        name: 'idx_domain_event_outbox_status_created',
        columnNames: ['delivery_status', 'persisted_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('domain_event_outbox');
  }
}
