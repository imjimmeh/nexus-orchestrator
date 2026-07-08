import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodQuery } from '../common/decorators/zod-query.decorator';
import {
  RuntimeFeedbackDiagnosticsQueryDto,
  runtimeFeedbackDiagnosticsQuerySchema,
  RuntimeFeedbackDiagnosticsService,
} from './runtime-feedback-diagnostics.service';

@UseGuards(JwtAuthGuard)
@Controller('runtime-feedback')
export class RuntimeFeedbackController {
  constructor(
    private readonly diagnostics: RuntimeFeedbackDiagnosticsService,
  ) {}

  @Get('diagnostics')
  async getDiagnostics(
    @ZodQuery(runtimeFeedbackDiagnosticsQuerySchema)
    query: RuntimeFeedbackDiagnosticsQueryDto,
  ) {
    const data = await this.diagnostics.getDiagnostics(query);
    return { success: true, data };
  }
}
