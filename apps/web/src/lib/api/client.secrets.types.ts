import type {
  CreateSecretRequest,
  ListSecretsParams,
  Secret,
  UpdateSecretRequest,
} from "./secrets.types";

export interface ApiClientSecretsMethods {
  getSecrets(
    this: import("./client").ApiClient,
    params?: ListSecretsParams,
  ): Promise<Secret[]>;
  getSecret(this: import("./client").ApiClient, id: string): Promise<Secret>;
  createSecret(
    this: import("./client").ApiClient,
    data: CreateSecretRequest,
  ): Promise<Secret>;
  updateSecret(
    this: import("./client").ApiClient,
    id: string,
    data: UpdateSecretRequest,
  ): Promise<Secret>;
  deleteSecret(this: import("./client").ApiClient, id: string): Promise<void>;
}
