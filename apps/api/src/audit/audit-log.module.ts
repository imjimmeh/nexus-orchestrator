import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditLogService } from './audit-log.service';

/**
 * Leaf module owning the cross-cutting audit-log writer. Depends only on
 * DatabaseModule (for AuditLogRepository), so any module that needs to record
 * audit entries imports this instead of reaching into SecurityModule — which
 * is what created the AuthorizationModule <-> SecurityModule cycle.
 */
@Module({
  imports: [DatabaseModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {
  protected readonly _moduleName = 'AuditLogModule';
}
