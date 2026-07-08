import { useSecrets } from "./useSecrets";
import type { SecretOptionsState } from "@/components/secrets/secret-option.types";

export function useSecretOptions(): SecretOptionsState {
  const { data: secrets = [], isError } = useSecrets();
  return {
    secrets: secrets.map((secret) => ({ id: secret.id, name: secret.name })),
    isError,
  };
}
