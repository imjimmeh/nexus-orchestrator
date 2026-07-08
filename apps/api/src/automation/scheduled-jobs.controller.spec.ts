import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ScheduledJobsController } from './scheduled-jobs.controller';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import {
  createScheduledJobSchema,
  updateScheduledJobSchema,
  ScheduledJobType,
} from '@nexus/core';

const mockService = {
  createScheduledJob: vi.fn(),
  listScheduledJobs: vi.fn(),
  getScheduledJob: vi.fn(),
  updateScheduledJob: vi.fn(),
  pauseScheduledJob: vi.fn(),
  resumeScheduledJob: vi.fn(),
  runScheduledJobNow: vi.fn(),
  deleteScheduledJob: vi.fn(),
  listScheduledJobRuns: vi.fn(),
};

describe('ScheduledJobsController', () => {
  let controller: ScheduledJobsController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ScheduledJobsController],
      providers: [{ provide: ScheduledJobsService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ScheduledJobsController);
  });

  describe('POST / (create)', () => {
    const validInput = {
      name: 'nightly refactor analysis',
      schedule_type: ScheduledJobType.CRON,
      schedule_expression: '*/15 * * * *',
      timezone: 'UTC',
      workflow_id: 'df6513c3-0270-47a3-a653-0d5ed18db6a5',
    };

    it('accepts valid cron schedule input', async () => {
      const mockResult = { id: 'job-1', ...validInput };
      mockService.createScheduledJob.mockResolvedValue(mockResult);

      const result = await controller.create(validInput);

      expect(result).toEqual({ success: true, data: mockResult });
      expect(mockService.createScheduledJob).toHaveBeenCalledWith(validInput);
    });

    it('ZodValidationPipe accepts valid input', () => {
      const pipe = new ZodValidationPipe(createScheduledJobSchema);
      const transformed = pipe.transform(validInput, { type: 'body' } as any);

      expect(transformed).toMatchObject(validInput);
    });

    it('ZodValidationPipe rejects missing required fields', () => {
      const pipe = new ZodValidationPipe(createScheduledJobSchema);
      expect(() => pipe.transform({}, { type: 'body' } as any)).toThrow(
        BadRequestException,
      );
    });

    it('ZodValidationPipe rejects invalid schedule_type', () => {
      const pipe = new ZodValidationPipe(createScheduledJobSchema);
      expect(() =>
        pipe.transform({ ...validInput, schedule_type: 'invalid' }, {
          type: 'body',
        } as any),
      ).toThrow(BadRequestException);
    });

    it('ZodValidationPipe rejects invalid workflow_id UUID', () => {
      const pipe = new ZodValidationPipe(createScheduledJobSchema);
      expect(() =>
        pipe.transform({ ...validInput, workflow_id: 'not-a-uuid' }, {
          type: 'body',
        } as any),
      ).toThrow(BadRequestException);
    });
  });

  describe('PATCH /:id (update)', () => {
    it('accepts partial update input', async () => {
      const updateInput = { name: 'updated name' };
      const mockResult = {
        id: 'job-1',
        name: 'updated name',
        schedule_type: ScheduledJobType.CRON,
        schedule_expression: '*/15 * * * *',
        timezone: 'UTC',
        workflow_id: 'df6513c3-0270-47a3-a653-0d5ed18db6a5',
      };
      mockService.updateScheduledJob.mockResolvedValue(mockResult);

      const result = await controller.update('job-1', updateInput);

      expect(result).toEqual({ success: true, data: mockResult });
      expect(mockService.updateScheduledJob).toHaveBeenCalledWith(
        'job-1',
        updateInput,
      );
    });

    it('ZodValidationPipe accepts valid partial update', () => {
      const pipe = new ZodValidationPipe(updateScheduledJobSchema);
      const transformed = pipe.transform({ name: 'new name' }, {
        type: 'body',
      } as any);

      expect(transformed).toEqual({ name: 'new name' });
    });
  });
});
