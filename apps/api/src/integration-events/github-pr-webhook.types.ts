import { z } from 'zod';

export const GithubPrWebhookPayloadSchema = z.object({
  action: z.string(),
  repository: z.object({
    name: z.string().min(1),
    owner: z.object({ login: z.string().min(1) }),
  }),
  pull_request: z.object({
    number: z.number().int(),
    merged: z.boolean().optional(),
    merge_commit_sha: z.string().nullable().optional(),
    html_url: z.string().min(1),
  }),
});

export type GithubPrWebhookPayload = z.infer<
  typeof GithubPrWebhookPayloadSchema
>;
