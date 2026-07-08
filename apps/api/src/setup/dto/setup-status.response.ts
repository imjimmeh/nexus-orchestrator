import { ApiProperty } from '@nestjs/swagger';

export class SetupStatusResponseDto {
  @ApiProperty()
  requiresSetup!: boolean;

  @ApiProperty()
  hasAnySecret!: boolean;

  @ApiProperty()
  hasActiveProvider!: boolean;

  @ApiProperty()
  hasActiveModel!: boolean;

  @ApiProperty()
  hasArchitectProfile!: boolean;
}
