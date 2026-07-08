import { IsUUID } from 'class-validator';

export class MoveScopeNodeDto {
  @IsUUID()
  newParentId: string;
}
