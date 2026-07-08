import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { SCOPE_NODE_TYPES } from '../scope.constants';
import type { ScopeNodeType } from '../scope.constants';

export class EnsureScopeNodeDto {
  @IsUUID()
  id: string;

  @IsUUID()
  @IsOptional()
  parentId: string | null;

  @IsIn(SCOPE_NODE_TYPES)
  type: ScopeNodeType;

  @IsString()
  @Length(1, 255)
  name: string;

  @IsString()
  @Length(1, 255)
  slug: string;
}
