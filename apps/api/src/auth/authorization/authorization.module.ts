import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth.module';
import { DatabaseModule } from '../../database/database.module';
import { RoleAssignment } from '../database/entities/role-assignment.entity';
import { AuthorizationService } from './authorization.service';
import { PermissionsGuard } from './permissions.guard';
import { RoleAssignmentService } from './role-assignment.service';
import { RoleAssignmentController } from './role-assignment.controller';
import { AuthorizationController } from './authorization.controller';
import { ScopeAccessService } from './scope-access.service';
import { EnforcementModeService } from './enforcement-mode.service';
import { EnforcementModeController } from './enforcement-mode.controller';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { AuditLogModule } from '../../audit/audit-log.module';
import { AuthorizationAuditService } from './authorization-audit.service';
import { AdminAccessIntegrityService } from './admin-access-integrity.service';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    TypeOrmModule.forFeature([RoleAssignment]),
    SystemSettingsModule,
    AuditLogModule,
  ],
  providers: [
    AuthorizationService,
    PermissionsGuard,
    RoleAssignmentService,
    ScopeAccessService,
    EnforcementModeService,
    AuthorizationAuditService,
    AdminAccessIntegrityService,
  ],
  controllers: [
    AuthorizationController,
    RoleAssignmentController,
    EnforcementModeController,
  ],
  exports: [
    AuthorizationService,
    PermissionsGuard,
    RoleAssignmentService,
    ScopeAccessService,
    EnforcementModeService,
    AuthorizationAuditService,
  ],
})
export class AuthorizationModule {}
