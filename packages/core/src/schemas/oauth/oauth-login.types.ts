import type { z } from "zod";
import type {
  oauthModalitySchema,
  oauthSessionStatusValueSchema,
  OAuthStartResultSchema,
  OAuthSessionStateSchema,
  OAuthSessionStatusSchema,
  StartProviderOAuthRequestSchema,
  StartHarnessOAuthRequestSchema,
  SubmitOAuthCodeRequestSchema,
} from "./oauth-login.schema";

export type OAuthModality = z.infer<typeof oauthModalitySchema>;
export type OAuthSessionStatusValue = z.infer<
  typeof oauthSessionStatusValueSchema
>;
export type OAuthStartResult = z.infer<typeof OAuthStartResultSchema>;
export type OAuthSessionState = z.infer<typeof OAuthSessionStateSchema>;
export type OAuthSessionStatus = z.infer<typeof OAuthSessionStatusSchema>;
export type StartProviderOAuthRequest = z.infer<
  typeof StartProviderOAuthRequestSchema
>;
export type StartHarnessOAuthRequest = z.infer<
  typeof StartHarnessOAuthRequestSchema
>;
export type SubmitOAuthCodeRequest = z.infer<
  typeof SubmitOAuthCodeRequestSchema
>;
