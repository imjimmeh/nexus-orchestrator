import {
  BadRequestException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

type ZodMetatype = {
  schema?: ZodTypeAny;
};

const PRIMITIVE_METATYPES: ReadonlySet<unknown> = new Set([
  String,
  Boolean,
  Number,
  Array,
  Object,
]);

@Injectable()
export class ZodValidationPipe<
  TSchema extends ZodTypeAny,
> implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema?: TSchema) {}

  transform(value: unknown, metadata?: ArgumentMetadata): unknown {
    const schema = this.resolveSchema(metadata);
    if (!schema) {
      return value;
    }

    const result = schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    throw new BadRequestException({
      message: 'Validation failed',
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    });
  }

  private resolveSchema(metadata?: ArgumentMetadata): ZodTypeAny | undefined {
    if (this.schema) {
      return this.schema;
    }

    const metatype = metadata?.metatype as ZodMetatype | undefined;
    if (!metatype || PRIMITIVE_METATYPES.has(metadata?.metatype)) {
      return undefined;
    }

    return metatype.schema;
  }
}
