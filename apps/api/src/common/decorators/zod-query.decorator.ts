import { Query } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

/**
 * Parameter decorator that binds and validates the entire query-string object
 * against a Zod schema.  Coercion is handled by the schema itself (e.g. z.coerce.number()).
 *
 * Usage:
 *   async listItems(@ZodQuery(MyQuerySchema) query: MyQuery) { … }
 */
export function ZodQuery(schema: ZodTypeAny) {
  return Query(new ZodValidationPipe(schema));
}
