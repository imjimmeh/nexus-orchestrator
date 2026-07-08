import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class UpdateScopeNodeDto {
  @IsString()
  @Length(1, 255)
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  isTenantRoot?: boolean;
}
