import { z } from "zod";

/**
 * Schema for refresh token request
 * Validates the presence of a refresh token for token rotation
 */
export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string(),
});

/**
 * Schema for refresh token response
 * Returns new access and refresh tokens with expiration time
 */
export const RefreshTokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});

type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;
type RefreshTokenResponse = z.infer<typeof RefreshTokenResponseSchema>;

export type { RefreshTokenRequest, RefreshTokenResponse };
