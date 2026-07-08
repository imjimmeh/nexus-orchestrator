import { ApiProperty } from '@nestjs/swagger';

export class InitializeSetupResponseDto {
  @ApiProperty({ example: true })
  initialized!: true;
}
