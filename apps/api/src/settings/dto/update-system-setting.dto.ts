import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsOptional, IsString } from 'class-validator';
import {
  updateSystemSettingSchema,
  type UpdateSystemSettingRequest,
} from '@nexus/core';

export class UpdateSystemSettingDto implements UpdateSystemSettingRequest {
  static get schema() {
    return updateSystemSettingSchema;
  }

  // @Allow() prevents whitelist:true from stripping this field before the
  // ZodValidationPipe runs (value is any JSON type, so no narrower validator).
  @Allow()
  @ApiProperty({ description: 'The new value (any JSON-serialisable type)' })
  value: unknown;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Human-readable description' })
  description?: string;
}
