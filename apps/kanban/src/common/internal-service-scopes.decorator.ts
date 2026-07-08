import { SetMetadata } from "@nestjs/common";

export const INTERNAL_SERVICE_SCOPES_METADATA_KEY = "internalServiceScopes";

export function InternalServiceScopes(...scopes: string[]) {
  return SetMetadata(INTERNAL_SERVICE_SCOPES_METADATA_KEY, scopes);
}
