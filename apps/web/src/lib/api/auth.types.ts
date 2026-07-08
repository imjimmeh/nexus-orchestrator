/**
 * Auth types shared by web client and (eventually) the backend API.
 *
 * Extracted from `./types.ts` as part of the api-types god-file split.
 * Foundational types (`Timestamps`, `AuthType`) come from `./common.types`.
 * `child-7` will sweep the re-exports in `./types.ts` once the rest of
 * the extraction work lands.
 */

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
