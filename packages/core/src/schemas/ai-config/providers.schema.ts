import { z } from "zod";

export const providerOwnerTypeSchema = z.enum(["global", "user", "scope"]);
export const providerOAuthStatusSchema = z.enum([
  "not_configured",
  "disconnected",
  "connected",
  "expired",
]);

export const ProviderOAuthAuthorizeRequestSchema = z.object({
  redirect_uri: z.url().optional(),
});

export const ProviderOAuthAuthorizeResponseSchema = z.object({
  authorizationUrl: z.url(),
  state: z.string().min(32),
});

export const ProviderOAuthCallbackRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(32),
});

export const ProviderOAuthStatusSchema = z.object({
  status: providerOAuthStatusSchema,
});

const nullableOptionalUrl = z.url().nullable().optional();

export const ProviderReferenceSchema = z.object({
  provider_id: z.uuid().optional(),
  provider_source: providerOwnerTypeSchema.optional(),
  provider_name: z.string().min(1).optional(),
  model_name: z.string().min(1).optional(),
});

export const ProviderCredentialSchema = z.object({
  api_key: z.string().optional(),
  extra: z.record(z.string(), z.string()).optional(),
  headers: z
    .array(z.object({ name: z.string().min(1), value: z.string() }))
    .optional(),
});

const CreateProviderObject = z.object({
  name: z.string().min(1),
  provider_id: z.string().optional().default("custom"),
  auth_type: z.string().optional(),
  secret_id: z.uuid().nullable().optional(),
  credential: ProviderCredentialSchema.optional(),
  runtime_env: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
  owner_type: providerOwnerTypeSchema.optional().default("global"),
  owner_id: z.string().min(1).nullable().optional(),
  oauth_authorization_url: nullableOptionalUrl,
  oauth_token_url: nullableOptionalUrl,
  oauth_client_id: z.string().min(1).nullable().optional(),
  oauth_client_secret_id: z.uuid().nullable().optional(),
  oauth_scopes: z.array(z.string().min(1)).nullable().optional(),
  oauth_redirect_uri: nullableOptionalUrl,
});

function refineCredential(
  data: { credential?: unknown; secret_id?: unknown; auth_type?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (!data.credential) return;
  if (data.secret_id) {
    ctx.addIssue({
      code: "custom",
      message: "Provide either an inline credential or a secret_id, not both",
      path: ["credential"],
    });
  }
  if (data.auth_type !== undefined && data.auth_type !== "api_key") {
    ctx.addIssue({
      code: "custom",
      message: "credential is only valid for api_key auth",
      path: ["credential"],
    });
  }
}

export const CreateProviderSchema =
  CreateProviderObject.superRefine(refineCredential);

export const UpdateProviderSchema =
  CreateProviderObject.partial().superRefine(refineCredential);

export type {
  CreateProviderRequest,
  ProviderCredentialInput,
  ProviderOAuthAuthorizeRequest,
  ProviderOAuthAuthorizeResponse,
  ProviderOAuthCallbackRequest,
  ProviderOAuthStatus,
  ProviderOAuthStatusValue,
  ProviderOwnerType,
  UpdateProviderRequest,
} from "./providers.types";
