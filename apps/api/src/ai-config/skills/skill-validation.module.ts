import { Module } from '@nestjs/common';
import { SkillValidationService } from './skill-validation.service';

@Module({
  providers: [SkillValidationService],
  exports: [SkillValidationService],
})
export class SkillValidationModule {}
