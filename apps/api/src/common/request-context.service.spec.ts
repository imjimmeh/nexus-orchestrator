import { RequestContextService } from './request-context.service';

// Prevent RequestContextLogger.init from running during tests
vi.mock('./logger.config', () => ({
  RequestContextLogger: {
    init: vi.fn(),
  },
}));

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  it('should return undefined when not inside a run() scope', () => {
    expect(service.getContext()).toBeUndefined();
    expect(service.getRequestId()).toBeUndefined();
    expect(service.getUserId()).toBeUndefined();
    expect(service.getWorkflowRunId()).toBeUndefined();
  });

  it('should provide context within a run() scope', () => {
    service.run({ requestId: 'req-123' }, () => {
      expect(service.getRequestId()).toBe('req-123');
      expect(service.getContext()).toEqual({ requestId: 'req-123' });
    });
  });

  it('should support nested properties', () => {
    service.run(
      { requestId: 'req-456', userId: 'user-1', workflowRunId: 'run-1' },
      () => {
        expect(service.getUserId()).toBe('user-1');
        expect(service.getWorkflowRunId()).toBe('run-1');
      },
    );
  });

  it('should isolate context across separate runs', () => {
    service.run({ requestId: 'req-A' }, () => {
      expect(service.getRequestId()).toBe('req-A');
    });

    service.run({ requestId: 'req-B' }, () => {
      expect(service.getRequestId()).toBe('req-B');
    });
  });

  it('should allow setting userId within a scope', () => {
    service.run({ requestId: 'req-789' }, () => {
      service.setUserId('user-set');
      expect(service.getUserId()).toBe('user-set');
    });
  });

  it('should allow setting workflowRunId within a scope', () => {
    service.run({ requestId: 'req-789' }, () => {
      service.setWorkflowRunId('wfr-set');
      expect(service.getWorkflowRunId()).toBe('wfr-set');
    });
  });

  it('should not throw when setting values outside a scope', () => {
    expect(() => {
      service.setUserId('user-outside');
    }).not.toThrow();
    expect(() => {
      service.setWorkflowRunId('wfr-outside');
    }).not.toThrow();
  });
});
