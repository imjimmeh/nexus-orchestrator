import { Param } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

/**
 * Parameter decorator that binds and validates a named route parameter
 * against a Zod schema.
 *
 * Usage:
 *   async getById(@ZodParam('id', UuidSchema) id: string) { … }
 */
export function ZodParam(param: string, schema: ZodTypeAny) {
  return Param(param, new ZodValidationPipe(schema));
}
