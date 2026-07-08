import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthorizationService } from './authorization.service';
import { EnforcementModeService } from './enforcement-mode.service';
import { PermissionsGuard } from './permissions.guard';
import { RoleAssignment } from '../database/entities/role-assignment.entity';
import { AuditLogRepository } from '../../audit/database/repositories/audit-log.repository';
import { Reflector } from '@nestjs/core';

describe('AuthorizationModule', () => {
  it('provides AuthorizationService and PermissionsGuard', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        PermissionsGuard,
        Reflector,
        {
          provide: getRepositoryToken(RoleAssignment),
          useValue: { query: async () => [] },
        },
        {
          provide: EnforcementModeService,
          useValue: { getMode: () => Promise.resolve('enforce') },
        },
        { provide: AuditLogRepository, useValue: { log: async () => ({}) } },
      ],
    }).compile();
    // Both providers are REQUEST-scoped (PermissionsGuard injects AuthorizationService),
    // so resolve() must be used instead of get()
    const authService = await moduleRef.resolve(AuthorizationService);
    expect(authService).toBeInstanceOf(AuthorizationService);
    const guard = await moduleRef.resolve(PermissionsGuard);
    expect(guard).toBeInstanceOf(PermissionsGuard);
  });
});
