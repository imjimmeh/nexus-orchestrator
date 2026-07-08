import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { AuditLogModule } from './audit-log.module';

@Module({
  imports: [AuthModule, AuthorizationModule, AuditLogModule],
  controllers: [AuditController],
})
export class AuditModule {}
