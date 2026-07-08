import { describe, expect, it, vi } from 'vitest';
import { AuditController } from './audit.controller';

const RAW_ITEM = {
  id: 'entry-1',
  event_type: 'authz.denied',
  actor_id: 'user-uuid',
  resource_id: 'scope-uuid',
  action: 'denied',
  result: 'denied',
  metadata: { requiredPermission: 'audit:read' },
  timestamp: new Date('2026-06-01T10:00:00.000Z'),
};

describe('AuditController', () => {
  describe('list()', () => {
    it('wraps mapped entries in { success: true, data: { entries, total } }', async () => {
      const auditSvc = {
        query: vi.fn().mockResolvedValue({ items: [RAW_ITEM], total: 1 }),
      } as any;
      const controller = new AuditController(auditSvc);

      const res = await controller.list(
        'scope-uuid',
        'authz.denied',
        '25',
        '0',
      );

      expect(res).toEqual({
        success: true,
        data: {
          entries: [
            {
              id: 'entry-1',
              eventType: 'authz.denied',
              userId: 'user-uuid',
              userEmail: 'user-uuid',
              scopeNodeId: 'scope-uuid',
              scopeNodeName: 'scope-uuid',
              metadata: { requiredPermission: 'audit:read' },
              createdAt: '2026-06-01T10:00:00.000Z',
            },
          ],
          total: 1,
        },
      });
    });

    it('calls the service with parsed pagination params', async () => {
      const auditSvc = {
        query: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      } as any;
      const controller = new AuditController(auditSvc);

      await controller.list('proj', 'authz.denied', '25', '0');

      expect(auditSvc.query).toHaveBeenCalledWith({
        scopeNodeId: 'proj',
        eventType: 'authz.denied',
        limit: 25,
        offset: 0,
      });
    });

    it('applies default pagination when params are absent', async () => {
      const auditSvc = {
        query: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      } as any;
      const controller = new AuditController(auditSvc);

      await controller.list(undefined, undefined, undefined, undefined);

      expect(auditSvc.query).toHaveBeenCalledWith({
        scopeNodeId: undefined,
        eventType: undefined,
        limit: 50,
        offset: 0,
      });
    });

    it('maps null resource_id to null scopeNodeId and scopeNodeName', async () => {
      const auditSvc = {
        query: vi.fn().mockResolvedValue({
          items: [{ ...RAW_ITEM, resource_id: undefined }],
          total: 1,
        }),
      } as any;
      const controller = new AuditController(auditSvc);

      const res = await controller.list(
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(res.data.entries[0].scopeNodeId).toBeNull();
      expect(res.data.entries[0].scopeNodeName).toBeNull();
    });
  });
});
