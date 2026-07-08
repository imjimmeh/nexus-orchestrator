import { Body } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

export function ZodBody(schema: ZodTypeAny) {
  return Body(new ZodValidationPipe(schema));
}
