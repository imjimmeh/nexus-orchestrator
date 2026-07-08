import type { z } from 'zod';
import {
  createGitOpsRepositoryBindingSchema,
  listGitOpsRepositoryBindingsQuerySchema,
  updateGitOpsRepositoryBindingSchema,
} from './gitops-repository-binding.dto';

export type CreateGitOpsRepositoryBindingDto = z.infer<
  typeof createGitOpsRepositoryBindingSchema
>;

export type UpdateGitOpsRepositoryBindingDto = z.infer<
  typeof updateGitOpsRepositoryBindingSchema
>;

export type ListGitOpsRepositoryBindingsQueryDto = z.infer<
  typeof listGitOpsRepositoryBindingsQuerySchema
>;
