import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { RuntimeFeedbackController } from './runtime-feedback.controller';
import { RuntimeFeedbackDiagnosticsService } from './runtime-feedback-diagnostics.service';
import { RuntimeFeedbackIngestionService } from './runtime-feedback-ingestion.service';
import { RuntimeFeedbackPolicyService } from './runtime-feedback-policy.service';
import { RuntimeFeedbackRedactionService } from './runtime-feedback-redaction.service';

@Module({
  imports: [AuthModule, DatabaseModule, ObservabilityModule],
  controllers: [RuntimeFeedbackController],
  providers: [
    RuntimeFeedbackDiagnosticsService,
    RuntimeFeedbackIngestionService,
    RuntimeFeedbackPolicyService,
    RuntimeFeedbackRedactionService,
  ],
  exports: [RuntimeFeedbackIngestionService, RuntimeFeedbackRedactionService],
})
export class RuntimeFeedbackModule {}
