import { z } from "zod";
import type {
  CreateProviderSchema,
  ProviderCredentialSchema,
  providerOwnerTypeSchema,
  providerOAuthStatusSchema,
  ProviderOAuthAuthorizeRequestSchema,
  ProviderOAuthAuthorizeResponseSchema,
  ProviderOAuthCallbackRequestSchema,
  ProviderOAuthStatusSchema,
  UpdateProviderSchema,
} from "./providers.schema";

export type CreateProviderRequest = z.input<typeof CreateProviderSchema>;
export type UpdateProviderRequest = z.input<typeof UpdateProviderSchema>;
export type ProviderCredentialInput = z.input<typeof ProviderCredentialSchema>;

export type ProviderOwnerType = z.infer<typeof providerOwnerTypeSchema>;
export type ProviderOAuthStatusValue = z.infer<
  typeof providerOAuthStatusSchema
>;
export type ProviderOAuthAuthorizeRequest = z.infer<
  typeof ProviderOAuthAuthorizeRequestSchema
>;
export type ProviderOAuthAuthorizeResponse = z.infer<
  typeof ProviderOAuthAuthorizeResponseSchema
>;
export type ProviderOAuthCallbackRequest = z.infer<
  typeof ProviderOAuthCallbackRequestSchema
>;
export type ProviderOAuthStatus = z.infer<typeof ProviderOAuthStatusSchema>;
