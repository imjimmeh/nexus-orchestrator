import { describe, expect, it } from 'vitest';
import { TypeOrmApiLogger } from './typeorm-api.logger';
import { getApiTypeOrmLoggingOptions } from './typeorm-logging.config';

describe('getApiTypeOrmLoggingOptions', () => {
  it('keeps query logging enabled through the debug-level API logger', () => {
    const options = getApiTypeOrmLoggingOptions();

    expect(options.logging).toEqual([
      'query',
      'error',
      'warn',
      'schema',
      'migration',
    ]);
    expect(options.logger).toBeInstanceOf(TypeOrmApiLogger);
  });
});
