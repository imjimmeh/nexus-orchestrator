import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { BootstrapService } from './bootstrap.service';
import { IAMPolicyService } from '../security/iam-policy.service';

describe('BootstrapService', () => {
  it('refreshes IAM policies on application bootstrap', async () => {
    const iam = { refreshPolicies: vi.fn(async () => undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BootstrapService,
        { provide: IAMPolicyService, useValue: iam },
      ],
    }).compile();

    await moduleRef.get(BootstrapService).onApplicationBootstrap();

    expect(iam.refreshPolicies).toHaveBeenCalledTimes(1);
  });
});
