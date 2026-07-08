import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypeOrmApiLogger } from './typeorm-api.logger';

describe('TypeOrmApiLogger', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs SQL queries at debug level', () => {
    const logger = new TypeOrmApiLogger();

    logger.logQuery('SELECT * FROM workflow_runs WHERE id = $1', ['run-1']);

    expect(debugSpy).toHaveBeenCalledWith(
      'query: SELECT * FROM workflow_runs WHERE id = $1 -- parameters: ["run-1"]',
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs query errors at error level', () => {
    const logger = new TypeOrmApiLogger();

    logger.logQueryError(
      'duplicate key value violates unique constraint',
      'INSERT INTO workflows(id) VALUES($1)',
      ['workflow-1'],
    );

    expect(errorSpy).toHaveBeenCalledWith(
      'query failed: INSERT INTO workflows(id) VALUES($1) -- parameters: ["workflow-1"] -- error: duplicate key value violates unique constraint',
    );
  });

  it('logs slow queries at warn level', () => {
    const logger = new TypeOrmApiLogger();

    logger.logQuerySlow(250, 'SELECT pg_sleep(1)', []);

    expect(warnSpy).toHaveBeenCalledWith(
      'slow query: SELECT pg_sleep(1) -- execution time: 250ms',
    );
  });

  it('logs schema and migration messages at normal log level', () => {
    const logger = new TypeOrmApiLogger();

    logger.logSchemaBuild('creating table workflow_runs');
    logger.logMigration('running migration 20260518120000');

    expect(logSpy).toHaveBeenCalledWith(
      'schema build: creating table workflow_runs',
    );
    expect(logSpy).toHaveBeenCalledWith(
      'migration: running migration 20260518120000',
    );
  });
});
