import { TypeOrmApiLogger } from './typeorm-api.logger';

export function getApiTypeOrmLoggingOptions() {
  return {
    logging: ['query', 'error', 'warn', 'schema', 'migration'],
    logger: new TypeOrmApiLogger(),
  } as Record<string, unknown>;
}
